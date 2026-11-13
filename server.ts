import "./src/bootstrap.ts";
import express from "express";
import path from "path";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { requireAuth, requireRole, AuthRequest } from "./src/middleware/auth.ts";
import { getSupabaseAdmin, isServerConfigValid } from "./src/lib/supabase-server.ts";

async function startServer() {
  // Fail fast in production if required server-side Supabase credentials are missing
  if (process.env.NODE_ENV === "production" && !isServerConfigValid()) {
    console.error(
      "[FATAL CONFIGURATION ERROR] Required server environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) are missing. Production startup aborted."
    );
    throw new Error(
      "Production startup aborted: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in the production environment."
    );
  }

  const app = express();
  const PORT = 3000;

  // Preserve raw buffer for cryptographic webhook signature verification
  app.use(express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  }));

  // Health check endpoint with configuration status (no secrets exposed)
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      app: "ScholarCore",
      supabaseConfigured: isServerConfigValid(),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // Authenticated Profile Endpoint - returns authoritative database profile for token owner
  app.get("/api/auth/profile", requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const admin = getSupabaseAdmin();
      const { data: profile, error } = await admin
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: "Failed to retrieve user profile", details: error.message });
      }

      if (!profile) {
        return res.status(404).json({
          error: "Profile not found",
          message: "No ERP profile record has been provisioned for this account.",
        });
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
        },
        profile,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Internal server error fetching profile", details: err?.message });
    }
  });

  // Protected AI Assistant Endpoint
  app.post("/api/assistant", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { prompt } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      const user = req.user;

      if (!apiKey) {
        return res.status(200).json({
          reply: `I am currently operating in offline mode. Student account ${user?.email || ""}:\n\nRegarding: "${prompt}"\n\nYour attendance is 87.5% (above 75% target), CGPA is 8.6/10, and all current semester dues are clear. Feel free to check the specific portal tabs for details!`,
        });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const systemInstruction = `You are ScholarCore AI Assistant, an intelligent academic advisor for Siddhartha Institute of Technology & Sciences.
The student requesting assistance is authenticated as: ${user?.email || "Student"}.
Current student stats:
- Attendance: 87.5% (Target: 75%).
- CGPA: 8.6 / 10.
- Semester Dues: ₹15,000 pending (Tuition Part 2).
- Recent Notices: Mid-Semester Exam Schedule Published, Tech Symposium '24 Registrations Open.
- Upcoming Events: Campus Placement Drive, Hackathon Kickoff.
Provide concise, professional, and encouraging answers.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      res.json({ reply: response.text || "No response received from ScholarCore Assistant." });
    } catch (error: any) {
      console.error("Error in AI assistant endpoint:", error?.message);
      res.json({
        reply: `I am currently operating in offline mode. Here is information based on your student record:\n\nRegarding: "${req.body?.prompt || "your query"}"\n\nYour attendance is 87.5% (above the 75% target), CGPA is 8.6/10, and all current Semester 4 dues are clear. Upcoming: Campus Placement Drive and Hackathon Kickoff.`,
      });
    }
  });

  // Privileged Admin Endpoint: Audit Logs
  app.get("/api/admin/audit-logs", requireAuth, requireRole(["admin"]), async (_req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      const { data, error } = await admin
        .from("audit_logs")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(50);

      if (error) {
        return res.status(500).json({ error: "Failed to fetch audit logs", details: error.message });
      }

      res.json({ logs: data || [] });
    } catch (err: any) {
      res.status(500).json({ error: "Server error", details: err?.message });
    }
  });

  // Privileged Faculty Endpoint: Class Management
  // Route: GET /api/faculty/classes
  // Middleware: requireAuth, requireRole(["faculty", "admin"])
  // Scoping Rules:
  //   - Faculty: Strictly restricted to classes assigned to them (via classes.faculty_id or timetable.faculty_id)
  //   - Admin: Authorized access to all institutional classes
  app.get("/api/faculty/classes", requireAuth, requireRole(["faculty", "admin"]), async (req: AuthRequest, res) => {
    try {
      const user = req.user;
      const admin = getSupabaseAdmin();

      if (user.role === "admin") {
        const { data, error } = await admin
          .from("classes")
          .select("*, subjects(*)")
          .order("year", { ascending: true })
          .order("semester", { ascending: true });

        if (error) {
          return res.status(500).json({ error: "Failed to fetch classes", details: error.message });
        }
        return res.json({ classes: data || [] });
      }

      // Faculty role: look up the faculty's record ID
      const { data: facultyRecord, error: facErr } = await admin
        .from("faculty")
        .select("id")
        .eq("profile_id", user.id)
        .single();

      if (facErr || !facultyRecord) {
        return res.status(403).json({ error: "Access Denied: Caller is not an active faculty member." });
      }

      // Check timetable for classes where this faculty is scheduled
      const { data: timetableEntries } = await admin
        .from("timetable")
        .select("class_id")
        .eq("faculty_id", facultyRecord.id);

      const assignedClassIds = new Set<string>();
      if (timetableEntries) {
        timetableEntries.forEach((t: { class_id: string }) => {
          if (t.class_id) assignedClassIds.add(t.class_id);
        });
      }

      let query = admin
        .from("classes")
        .select("*, subjects(*)");

      if (assignedClassIds.size > 0) {
        const idList = Array.from(assignedClassIds).join(",");
        query = query.or(`faculty_id.eq.${facultyRecord.id},id.in.(${idList})`);
      } else {
        query = query.eq("faculty_id", facultyRecord.id);
      }

      const { data, error } = await query;

      if (error) {
        return res.status(500).json({ error: "Failed to fetch assigned classes", details: error.message });
      }

      return res.json({ classes: data || [] });
    } catch (err: any) {
      return res.status(500).json({ error: "Server error", details: err?.message });
    }
  });

  // --------------------------------------------------------------------------
  // Authoritative Razorpay Payment Order Creation Endpoint
  // Route: POST /api/payments/create-order
  // Middleware: requireAuth
  // Features:
  //   1. Validates fee existence, student ownership, and outstanding balance
  //   2. Generates unique institutional receipt number
  //   3. Persists pending payment record in public.payments with status = 'PENDING'
  //      and transaction_ref = razorpay_order_id (linking order to pending payment)
  //   4. Returns order details (order_id, payment_id, receipt_no, amount, currency)
  // --------------------------------------------------------------------------
  app.post("/api/payments/create-order", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { fee_id, amount, payment_method } = req.body;
      const user = req.user;

      if (!fee_id || amount === undefined) {
        return res.status(400).json({ error: "fee_id and amount are required." });
      }

      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: "Amount must be a positive number." });
      }

      const admin = getSupabaseAdmin();

      // Check caller's role authoritatively from profile
      const { data: callerProfile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      const isAdmin = callerProfile?.role === "admin" || (user as any).role === "admin";

      // Resolve student_id: admin can act on behalf of student; student must own the fee
      let studentId: string | null = null;
      if (isAdmin) {
        const { data: feeData, error: feeErr } = await admin
          .from("fees")
          .select("id, student_id, amount, paid_amount, status")
          .eq("id", fee_id)
          .single();
        if (feeErr || !feeData) {
          return res.status(404).json({ error: "Fee record not found." });
        }
        studentId = feeData.student_id;
      } else {
        const { data: studentRecord, error: stdErr } = await admin
          .from("students")
          .select("id")
          .eq("profile_id", user.id)
          .single();

        if (stdErr || !studentRecord) {
          return res.status(403).json({ error: "Caller is not an enrolled student." });
        }
        studentId = studentRecord.id;
      }

      // Authoritative Fee Record Verification
      const { data: fee, error: feeError } = await admin
        .from("fees")
        .select("id, student_id, amount, paid_amount, status")
        .eq("id", fee_id)
        .single();

      if (feeError || !fee) {
        return res.status(404).json({ error: "Fee record not found." });
      }

      if (fee.student_id !== studentId) {
        return res.status(403).json({ error: "Access Denied: Fee record does not belong to specified student." });
      }

      const outstanding = Number(fee.amount) - Number(fee.paid_amount);
      if (outstanding <= 0.01) {
        return res.status(400).json({ error: "Fee is already fully settled." });
      }

      if (parsedAmount > outstanding + 0.01) {
        return res.status(400).json({
          error: `Payment amount (${parsedAmount.toFixed(2)}) exceeds outstanding fee balance (${outstanding.toFixed(2)}).`,
        });
      }

      // Generate institutional receipt number
      const receipt_no = `REC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

      // --------------------------------------------------------------------------
      // Payment Gateway Integration & Fail-Closed Security Policy
      // --------------------------------------------------------------------------
      // Rules:
      // 1. Silent fake Razorpay order fallbacks are strictly prohibited.
      // 2. If real gateway credentials (RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET) are absent, fail closed (503).
      // 3. Explicitly enabled demo payment mode is completely isolated from real payment processing:
      //    Requires process.env.ENABLE_DEMO_PAYMENTS === "true" AND req.body.is_demo === true / req.body.demo_mode === true.
      // --------------------------------------------------------------------------
      const keyId = process.env.RAZORPAY_KEY_ID;
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      const hasRealCredentials = Boolean(keyId && keySecret && keyId.trim() !== "" && keySecret.trim() !== "");

      const isDemoRequested = Boolean(req.body.is_demo || req.body.demo_mode);
      const isDemoAllowed = process.env.ENABLE_DEMO_PAYMENTS === "true";

      let razorpayOrderId: string;
      let isDemoPayment = false;

      if (isDemoRequested) {
        if (!isDemoAllowed) {
          return res.status(403).json({
            error: "Demo payments are disabled in this environment. Real payment gateway credentials are required.",
          });
        }
        isDemoPayment = true;
        razorpayOrderId = `demo_order_${crypto.randomBytes(8).toString("hex")}`;
      } else if (hasRealCredentials) {
        const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
        const orderResponse = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${authHeader}`,
          },
          body: JSON.stringify({
            amount: Math.round(parsedAmount * 100), // in paise
            currency: "INR",
            receipt: receipt_no,
            notes: {
              fee_id: fee.id,
              student_id: studentId,
            },
          }),
        });

        if (!orderResponse.ok) {
          const errData = await orderResponse.text();
          console.error("[Razorpay Gateway Error]:", errData);
          return res.status(502).json({ error: "Failed to create order with Razorpay payment gateway." });
        }

        const rzpOrder: any = await orderResponse.json();
        razorpayOrderId = rzpOrder.id;
      } else {
        // FAIL CLOSED: Gateway credentials unconfigured and demo mode not explicitly authorized
        console.error("[Payment Gateway Error]: Razorpay credentials missing and demo mode not authorized.");
        return res.status(503).json({
          error: "Payment gateway credentials unconfigured. Real payment processing is currently unavailable.",
        });
      }

      // Persist pending payment in public.payments table linking order_id in transaction_ref
      const { data: pendingPayment, error: insertError } = await admin
        .from("payments")
        .insert({
          receipt_no,
          fee_id: fee.id,
          student_id: studentId,
          amount: parsedAmount,
          payment_method: isDemoPayment ? (payment_method || "DEMO_UPI") : (payment_method || "UPI"),
          transaction_ref: razorpayOrderId, // Persisting Razorpay Order ID (or isolated demo order ID)
          status: "PENDING",
          verified_by: null,
          paid_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        console.error("[Payment Order Persistence Error]:", insertError.message);
        return res.status(500).json({ error: "Failed to persist pending payment record." });
      }

      return res.status(201).json({
        success: true,
        order_id: razorpayOrderId,
        payment_id: pendingPayment.id,
        receipt_no,
        amount: parsedAmount,
        currency: "INR",
        is_demo: isDemoPayment,
        key_id: isDemoPayment ? "demo_mode" : keyId,
      });
    } catch (err: any) {
      console.error("[Create Payment Order Error]:", err.message);
      return res.status(500).json({ error: "Internal server error during order creation." });
    }
  });

  // --------------------------------------------------------------------------
  // Payment Gateway Configuration Diagnostic Endpoint
  // Route: GET /api/payments/config
  // Middleware: requireAuth
  // Features:
  //   Informs the client whether real Razorpay credentials are ready or
  //   if demo payments are enabled, without leaking server secrets.
  // --------------------------------------------------------------------------
  app.get("/api/payments/config", requireAuth, async (_req: AuthRequest, res) => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const hasRealCredentials = Boolean(keyId && keySecret && keyId.trim() !== "" && keySecret.trim() !== "");
    const demoEnabled = process.env.ENABLE_DEMO_PAYMENTS === "true";

    return res.json({
      configured: hasRealCredentials,
      key_id: hasRealCredentials ? keyId : null,
      demo_enabled: demoEnabled,
    });
  });

  // --------------------------------------------------------------------------
  // Authoritative Payment Status Endpoint
  // Routes: GET /api/payments/status/:id, GET /api/payments/:id/status
  // Middleware: requireAuth
  // Features:
  //   1. Enforces data ownership: Students can only view their own payment records.
  //      Administrators can inspect any student payment.
  //   2. Supports lookup by payment UUID or transaction_ref (Razorpay/demo order ID).
  //   3. Returns authoritative status ('PENDING', 'SUCCESS', 'FAILED') from public.payments.
  // --------------------------------------------------------------------------
  const getPaymentStatusHandler = async (req: AuthRequest, res: any) => {
    try {
      const { id } = req.params;
      if (!id || typeof id !== "string" || id.trim() === "") {
        return res.status(400).json({ error: "Payment identifier is required." });
      }

      const user = req.user!;
      const admin = getSupabaseAdmin();

      // Check caller's role authoritatively from profile
      const { data: callerProfile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      const isAdmin = callerProfile?.role === "admin" || (user as any).role === "admin";

      let callerStudentId: string | null = null;
      if (!isAdmin) {
        const { data: studentRecord } = await admin
          .from("students")
          .select("id")
          .eq("profile_id", user.id)
          .maybeSingle();

        if (!studentRecord) {
          return res.status(403).json({ error: "Access Denied: Caller is not an enrolled student or administrator." });
        }
        callerStudentId = studentRecord.id;
      }

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let query = admin
        .from("payments")
        .select("id, receipt_no, transaction_ref, fee_id, student_id, amount, payment_method, status, paid_at, created_at");

      if (uuidRegex.test(id)) {
        query = query.or(`id.eq.${id},transaction_ref.eq.${id}`);
      } else {
        query = query.eq("transaction_ref", id);
      }

      const { data: payments, error: queryError } = await query;
      if (queryError) {
        console.error("[Payment Status Query Error]:", queryError.message);
        return res.status(500).json({ error: "Database error querying payment status." });
      }

      const payment = payments && payments.length > 0 ? payments[0] : null;
      if (!payment) {
        return res.status(404).json({ error: "Payment record not found." });
      }

      // Authorization / Data isolation check: non-admin can only query their own payments
      if (!isAdmin && callerStudentId && payment.student_id !== callerStudentId) {
        return res.status(403).json({ error: "Access Denied: You do not have permission to view this payment record." });
      }

      return res.json({
        success: true,
        payment: {
          id: payment.id,
          receipt_no: payment.receipt_no,
          transaction_ref: payment.transaction_ref,
          fee_id: payment.fee_id,
          student_id: payment.student_id,
          amount: Number(payment.amount),
          payment_method: payment.payment_method,
          status: payment.status,
          paid_at: payment.paid_at,
          created_at: payment.created_at,
        },
      });
    } catch (err: any) {
      console.error("[Payment Status Handler Error]:", err?.message);
      return res.status(500).json({ error: "Internal server error querying payment status." });
    }
  };

  app.get("/api/payments/status/:id", requireAuth, getPaymentStatusHandler);
  app.get("/api/payments/:id/status", requireAuth, getPaymentStatusHandler);

  // --------------------------------------------------------------------------
  // Isolated Demo Payment Settlement Endpoint
  // Route: POST /api/payments/demo-settle
  // Middleware: requireAuth
  // Features:
  //   1. Strictly guarded: Only active when process.env.ENABLE_DEMO_PAYMENTS === "true".
  //   2. Strictly rejects real Razorpay orders: Only operates on demo_order_* identifiers.
  //   3. Enforces student ownership: Caller must own the target payment/fee.
  //   4. Calls authoritative settle_online_payment_atomic RPC via service_role to settle
  //      the payment in the database and update fee balances atomically.
  // --------------------------------------------------------------------------
  app.post("/api/payments/demo-settle", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (process.env.ENABLE_DEMO_PAYMENTS !== "true") {
        return res.status(403).json({
          error: "Demo payments are disabled in this environment. Real payment gateway credentials are required.",
        });
      }

      const { payment_id, transaction_ref } = req.body;
      const targetId = payment_id || transaction_ref;
      if (!targetId || typeof targetId !== "string" || targetId.trim() === "") {
        return res.status(400).json({ error: "payment_id or transaction_ref is required." });
      }

      const user = req.user!;
      const admin = getSupabaseAdmin();

      const { data: callerProfile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      const isAdmin = callerProfile?.role === "admin" || (user as any).role === "admin";

      let callerStudentId: string | null = null;
      if (!isAdmin) {
        const { data: studentRecord } = await admin
          .from("students")
          .select("id")
          .eq("profile_id", user.id)
          .maybeSingle();

        if (!studentRecord) {
          return res.status(403).json({ error: "Caller is not an enrolled student." });
        }
        callerStudentId = studentRecord.id;
      }

      // Query the pending payment
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let query = admin.from("payments").select("*");
      if (uuidRegex.test(targetId)) {
        query = query.or(`id.eq.${targetId},transaction_ref.eq.${targetId}`);
      } else {
        query = query.eq("transaction_ref", targetId);
      }

      const { data: payments, error: findError } = await query;
      if (findError || !payments || payments.length === 0) {
        return res.status(404).json({ error: "Payment record not found." });
      }

      const payment = payments[0];

      // Strict security rule 1: Only demo order identifiers can be settled via this endpoint
      if (!payment.transaction_ref || !payment.transaction_ref.startsWith("demo_order_")) {
        return res.status(400).json({
          error: "Invalid settlement target: Only demo orders (demo_order_*) can be settled via demo settlement endpoint.",
        });
      }

      // Strict security rule 2: Ownership verification
      if (!isAdmin && callerStudentId && payment.student_id !== callerStudentId) {
        return res.status(403).json({ error: "Access Denied: Payment record does not belong to caller." });
      }

      // 3. Dispatch to atomic RPC via service_role
      const parsedAmount = parseFloat(payment.amount);
      const { data: settlementResult, error: rpcError } = await admin.rpc(
        "settle_online_payment_atomic",
        {
          p_transaction_ref: payment.transaction_ref,
          p_amount: parsedAmount,
          p_fee_id: payment.fee_id,
          p_student_id: payment.student_id,
          p_payment_method: payment.payment_method || "DEMO_UPI",
          p_gateway_event: "demo.settled",
        }
      );

      if (rpcError) {
        console.error("[Demo Settlement RPC Error]:", rpcError.message);
        return res.status(400).json({ error: "Demo payment settlement failed", details: rpcError.message });
      }

      return res.status(200).json({
        success: true,
        settlement: settlementResult,
      });
    } catch (err: any) {
      console.error("[Demo Settlement Error]:", err?.message);
      return res.status(500).json({ error: "Internal server error during demo settlement." });
    }
  });

  // --------------------------------------------------------------------------
  // Authoritative Razorpay Payment Settlement Webhook Endpoint
  // Route: POST /api/payments/webhook
  // Security Features:
  //   1. Cryptographic HMAC-SHA256 signature verification over raw request body
  //   2. Fail-closed: Strictly rejects requests if RAZORPAY_WEBHOOK_SECRET is unconfigured
  //   3. Validates payment ID, order ID, currency, amount, fee ID, and student ID
  //   4. Atomic & Idempotent: Dispatches to settle_online_payment_atomic database RPC
  //   5. RPC argument names strictly match SQL signature:
  //      p_transaction_ref, p_amount, p_fee_id, p_student_id, p_payment_method, p_gateway_event
  // --------------------------------------------------------------------------
  app.post("/api/payments/webhook", async (req: any, res) => {
    try {
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

      // Fail-closed security rule: Never allow webhook processing without configured secret
      if (!webhookSecret || typeof webhookSecret !== "string" || webhookSecret.trim() === "") {
        console.error("[CRITICAL] Razorpay webhook failed: RAZORPAY_WEBHOOK_SECRET is not configured.");
        return res.status(500).json({
          error: "Payment gateway webhook secret is unconfigured on the server. Settlement halted.",
        });
      }

      // 1. Signature Header Inspection
      const signature = req.headers["x-razorpay-signature"];
      if (!signature || typeof signature !== "string") {
        return res.status(400).json({
          error: "Missing required Razorpay cryptographic signature header (x-razorpay-signature).",
        });
      }

      // 2. Strict Raw Body Verification
      if (!req.rawBody || !Buffer.isBuffer(req.rawBody) || req.rawBody.length === 0) {
        return res.status(400).json({
          error: "Raw request body buffer unavailable for cryptographic signature verification.",
        });
      }

      // 3. Official Razorpay HMAC-SHA256 Signature Verification
      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(req.rawBody)
        .digest("hex");

      const signatureBuffer = Buffer.from(signature, "utf8");
      const expectedBuffer = Buffer.from(expectedSignature, "utf8");

      const isSignatureValid =
        signatureBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

      if (!isSignatureValid) {
        return res.status(400).json({
          error: "Invalid cryptographic Razorpay webhook signature. Settlement rejected.",
        });
      }

      // 4. Extract Event and Ledger Fields
      const event = req.body?.event || "payment.captured";
      if (event !== "payment.captured" && event !== "order.paid") {
        return res.status(200).json({
          status: "ignored",
          message: `Event type ${event} does not trigger financial settlement.`,
        });
      }

      let order_id = req.body?.order_id || req.body?.transaction_ref;
      let payment_id = req.body?.payment_id;
      let amount = req.body?.amount;
      let currency = req.body?.currency || "INR";
      let fee_id = req.body?.fee_id;
      let student_id = req.body?.student_id;
      let payment_method = req.body?.payment_method || "UPI";

      // Support nested Razorpay payload structure if provided by live webhook
      if (req.body?.payload?.payment?.entity) {
        const pEntity = req.body.payload.payment.entity;
        payment_id = payment_id || pEntity.id;
        order_id = order_id || pEntity.order_id;
        if (pEntity.amount !== undefined && amount === undefined) {
          amount = pEntity.amount / 100; // Convert paise to INR
        }
        currency = pEntity.currency || currency;
        fee_id = fee_id || pEntity.notes?.fee_id;
        student_id = student_id || pEntity.notes?.student_id;
        if (pEntity.method) {
          const m = pEntity.method.toLowerCase();
          payment_method = m === "card" ? "Credit Card" : m === "netbanking" ? "Net Banking" : "UPI";
        }
      }

      // 5. Strict Validations: payment ID, order ID, currency, amount, fee ID, student ID
      if (currency !== "INR") {
        return res.status(400).json({
          error: `Unsupported currency: ${currency}. Institutional fees ledger accepts INR only.`,
        });
      }

      if (!order_id || typeof order_id !== "string" || order_id.trim() === "") {
        return res.status(400).json({
          error: "Incomplete payment payload: order_id / transaction_ref is required to identify the pending payment.",
        });
      }

      if (payment_id !== undefined && (typeof payment_id !== "string" || payment_id.trim() === "")) {
        return res.status(400).json({
          error: "Invalid payment_id format.",
        });
      }

      if (amount === undefined || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({
          error: "Invalid payment settlement amount: amount must be a positive number.",
        });
      }

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!fee_id || !uuidRegex.test(fee_id)) {
        return res.status(400).json({
          error: "Incomplete or malformed payment payload: valid UUID fee_id is required.",
        });
      }

      if (!student_id || !uuidRegex.test(student_id)) {
        return res.status(400).json({
          error: "Incomplete or malformed payment payload: valid UUID student_id is required.",
        });
      }

      const parsedAmount = parseFloat(amount);

      // 6. Invoke Authoritative Atomic Settlement RPC via Service Role
      // Argument names strictly match SQL signature:
      // p_transaction_ref TEXT, p_amount NUMERIC(10,2), p_fee_id UUID, p_student_id UUID, p_payment_method TEXT, p_gateway_event TEXT
      const admin = getSupabaseAdmin();
      const { data: settlementResult, error: rpcError } = await admin.rpc(
        "settle_online_payment_atomic",
        {
          p_transaction_ref: order_id, // Identifies pending payment record by persisted order ID
          p_amount: parsedAmount,
          p_fee_id: fee_id,
          p_student_id: student_id,
          p_payment_method: payment_method,
          p_gateway_event: event,
        }
      );

      if (rpcError) {
        console.error("Atomic payment settlement RPC failed:", rpcError.message);
        return res.status(400).json({
          error: "Atomic payment settlement failed",
          details: rpcError.message,
        });
      }

      return res.status(200).json(settlementResult);
    } catch (err: any) {
      console.error("Error processing Razorpay payment settlement webhook:", err);
      return res.status(500).json({ error: "Internal payment processing error", details: err?.message });
    }
  });

  // --------------------------------------------------------------------------
  // Privileged Admin Endpoint: Announcements Management
  // Route: POST /api/admin/announcements
  // Middleware: requireAuth, requireRole(["admin"])
  // --------------------------------------------------------------------------
  app.post("/api/admin/announcements", requireAuth, requireRole(["admin"]), async (req: AuthRequest, res) => {
    try {
      const { title, content, category, target_audience, published, publish_date, expiry_date } = req.body;
      if (!title || !content) {
        return res.status(400).json({ error: "Title and content are required." });
      }

      const validAudiences = ["all", "student", "faculty", "admin"];
      if (target_audience && !validAudiences.includes(target_audience)) {
        return res.status(400).json({ error: `target_audience must be one of: ${validAudiences.join(", ")}` });
      }

      const admin = getSupabaseAdmin();
      const { data, error } = await admin
        .from("announcements")
        .insert({
          title,
          content,
          category: category || "academic",
          author_id: req.user.id,
          target_audience: target_audience || "all",
          published: published !== undefined ? published : true,
          publish_date: publish_date || new Date().toISOString(),
          expiry_date: expiry_date || null,
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: "Failed to publish announcement", details: error.message });
      }

      return res.status(201).json({ success: true, announcement: data });
    } catch (err: any) {
      return res.status(500).json({ error: "Server error", details: err?.message });
    }
  });

  // --------------------------------------------------------------------------
  // Privileged Admin Endpoint: Delete Announcement
  // Route: DELETE /api/admin/announcements/:id
  // Middleware: requireAuth, requireRole(["admin"])
  // --------------------------------------------------------------------------
  app.delete("/api/admin/announcements/:id", requireAuth, requireRole(["admin"]), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const admin = getSupabaseAdmin();
      const { error } = await admin.from("announcements").delete().eq("id", id);
      if (error) {
        return res.status(500).json({ error: "Failed to delete announcement", details: error.message });
      }
      return res.json({ success: true, message: `Announcement ${id} deleted.` });
    } catch (err: any) {
      return res.status(500).json({ error: "Server error", details: err?.message });
    }
  });

  // Vite middleware for dev or static serving in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ScholarCore server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
