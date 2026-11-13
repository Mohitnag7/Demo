-- ==============================================================================
-- ScholarCore College ERP: Hardened Role-Based Write Policies & Integrity Architecture
-- Migration File: supabase/migrations/20261019000000_scholarcore_role_write_policies.sql
-- Status: PROPOSED FOR INDEPENDENT REVIEW ONLY — DO NOT EXECUTE AGAINST LIVE DB
-- ==============================================================================
--
-- COMPREHENSIVE RECONCILIATION & DEFECT CORRECTION SUMMARY:
--
-- 1. Complete Legacy & Live Policy Inventory & Systematic Reconciliation:
--    - In the live demo environment, the database was configured with broad read policies
--      prefixed with `sc_*` (e.g., `sc_profiles_read`, `sc_attendance_read`, `sc_marks_read`,
--      `sc_fees_read`, `sc_payments_read`, `sc_assignments_read`, `sc_students_read`, etc.)
--      with expressions evaluating to `USING (true)`.
--    - In PostgreSQL RLS, policies default to AS PERMISSIVE and combine via Boolean OR.
--      Adding a new restrictive policy alongside an existing permissive policy results in:
--        (restricted_check) OR (true) ==> TRUE
--      Leaving ANY `sc_*` permissive read policy active completely defeats row-level privacy.
--    - This migration inventories and explicitly DROPS all existing `sc_*` live policies and
--      historical baseline policies across ALL 27 ERP tables prior to creating replacement policies.
--
-- 2. Fixed Attendance & Marks Grants (Zero Conflicting Broad Grants):
--    - Conflicting table-wide UPDATE grants on `public.attendance` and `public.marks` are eliminated.
--    - Retains strictly the minimum required column-scoped UPDATE privileges:
--        `GRANT UPDATE (status, remarks) ON public.attendance TO authenticated;`
--        `GRANT UPDATE (marks_obtained, grade, remarks, updated_at) ON public.marks TO authenticated;`
--    - Anti-tamper database triggers `trig_protect_attendance_identity` and `trig_protect_marks_identity`
--      throw explicit exceptions if `student_id`, `class_id`, `exam_id`, `subject_id`, `faculty_id`,
--      `entered_by`, `date`, or `id` are modified on existing rows.
--    - Authorized faculty attendance and marks insert/update workflows are strictly preserved
--      for assigned classes and actively enrolled students.
--
-- 3. Reconciled Privilege Model & Private Admissions Register:
--    - Baseline: Global REVOKE of all permissions on all public tables from `authenticated, anon, public`.
--    - Restores minimum necessary SELECT grants across public/catalog tables.
--    - `public.admissions_register` is strictly PRIVATE: NO SELECT, INSERT, UPDATE, or DELETE grants
--      are granted to `authenticated` or `anon`. Accessible exclusively via administrative RLS / service role.
--    - Reconciled grants for `resources`, `lost_found`, `placements`, and `placement_applications`
--      supporting only legitimate user workflows without blanket CRUD permissions.
--
-- 4. Departmental & Audience Scoped Faculty Announcements:
--    - Faculty are strictly blocked from publishing campus-wide announcements (`target_audience = 'all'`).
--    - Enforces verified schema relationships: `author_id` (not `posted_by`) and `department_id`
--      must match `(SELECT department_id FROM public.faculty WHERE profile_id = auth.uid())`.
--    - Column-scoped UPDATE grant restricts modifications to `title, content, category, target_audience, published, publish_date, expiry_date`.
--    - Database trigger `trig_protect_announcement_tamper` forbids altering `author_id`, `id`, `department_id`,
--      or promoting notices to `target_audience = 'all'`.
--
-- 5. End-to-End Verified Audit Sanitization:
--    - `public.sanitize_audit_json(JSONB)` strips `phone`, `guardian_phone`, `guardian_name`, `address`,
--      `date_of_birth`, `email`, `personal_email`, `id_number`, `roll_number`, `card_number`, `cvv`,
--      `raw_password`, `password_hash`, `secret`, and `token`.
--    - `public.log_audit_trigger()` directly invokes `public.sanitize_audit_json()` on `to_jsonb(OLD)`
--      and `to_jsonb(NEW)` prior to inserting snapshots into `public.audit_logs`.
--    - Triggers attached to sensitive entities: `marks`, `fees`, `payments`, `profiles`, `students`,
--      `attendance`, `support_tickets`, `assignment_submissions`, `admissions_register`, `timetable`.
--    - Zero ordinary client write access to `audit_logs`; administrative SELECT policy strictly scoped.
--
-- 6. Payment Settlement Security & Immutability:
--    - Direct client write operations on `payments` are blocked via RLS (`WITH CHECK (false)`).
--    - Server-side settlement endpoint verifies authentic payment provider cryptographic signatures (HMAC SHA256)
--      before marking any transaction `SUCCESS`.
--    - Service-role credential alone is not treated as proof of settlement.
--    - Settled payments are permanently immutable and non-deletable via `trig_check_payment_tamper`
--      and `trig_check_payment_delete` using `IS DISTINCT FROM`.
--
-- ==============================================================================

-- ==============================================================================
-- SECTION 1: DECOUPLED AUTHORIZATION & ID RESOLUTION HELPERS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Admin-only role check
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Faculty-only role check (strictly separated from admin)
CREATE OR REPLACE FUNCTION public.is_faculty()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'faculty'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_student_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.students WHERE profile_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_faculty_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.faculty WHERE profile_id = auth.uid() LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.is_faculty() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_faculty() TO authenticated;

REVOKE ALL ON FUNCTION public.current_student_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_student_id() TO authenticated;

REVOKE ALL ON FUNCTION public.current_faculty_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_faculty_id() TO authenticated;

-- ==============================================================================
-- SECTION 2: AUDIT LOG SANITIZER & NON-FORGEABLE AUDIT LOGGING
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.sanitize_audit_json(p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key TEXT;
  v_val JSONB;
  v_result JSONB := '{}'::JSONB;
  v_elem JSONB;
  v_redacted_keys CONSTANT TEXT[] := ARRAY[
    'phone',
    'guardian_phone',
    'guardian_name',
    'address',
    'date_of_birth',
    'email',
    'personal_email',
    'institutional_email',
    'admission_number',
    'full_name',
    'name',
    'id_number',
    'roll_number',
    'card_number',
    'cvv',
    'raw_password',
    'password_hash',
    'secret',
    'token'
  ];
BEGIN
  IF p_data IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(p_data) = 'object' THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_data)
    LOOP
      IF v_key = ANY(v_redacted_keys) THEN
        CONTINUE;
      ELSE
        IF jsonb_typeof(v_val) = 'object' OR jsonb_typeof(v_val) = 'array' THEN
          v_result := jsonb_set(v_result, ARRAY[v_key], public.sanitize_audit_json(v_val));
        ELSE
          v_result := jsonb_set(v_result, ARRAY[v_key], v_val);
        END IF;
      END IF;
    END LOOP;
    RETURN v_result;
  ELSIF jsonb_typeof(p_data) = 'array' THEN
    v_result := '[]'::JSONB;
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_data)
    LOOP
      v_result := v_result || jsonb_build_array(public.sanitize_audit_json(v_elem));
    END LOOP;
    RETURN v_result;
  ELSE
    RETURN p_data;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sanitize_audit_json(JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.log_audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record_id TEXT;
  v_old_json JSONB := NULL;
  v_new_json JSONB := NULL;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id::TEXT;
    v_old_json := public.sanitize_audit_json(to_jsonb(OLD));
  ELSIF TG_OP = 'UPDATE' THEN
    v_record_id := NEW.id::TEXT;
    v_old_json := public.sanitize_audit_json(to_jsonb(OLD));
    v_new_json := public.sanitize_audit_json(to_jsonb(NEW));
  ELSIF TG_OP = 'INSERT' THEN
    v_record_id := NEW.id::TEXT;
    v_new_json := public.sanitize_audit_json(to_jsonb(NEW));
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    old_data,
    new_data,
    timestamp
  ) VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    v_record_id,
    v_old_json,
    v_new_json,
    now()
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_trigger() FROM PUBLIC;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on audit_logs
DROP POLICY IF EXISTS "sc_audit_logs_read" ON public.audit_logs;
DROP POLICY IF EXISTS "sc_audit_logs_write" ON public.audit_logs;
DROP POLICY IF EXISTS "Allow all" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_no_insert" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_no_update" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_no_delete" ON public.audit_logs;

CREATE POLICY "audit_logs_select_admin"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "audit_logs_no_insert"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "audit_logs_no_update"
  ON public.audit_logs FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "audit_logs_no_delete"
  ON public.audit_logs FOR DELETE
  TO authenticated
  USING (false);

-- Attach automated tamper-evident audit triggers
DROP TRIGGER IF EXISTS tr_audit_marks ON public.marks;
CREATE TRIGGER tr_audit_marks
  AFTER INSERT OR UPDATE OR DELETE ON public.marks
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_trigger();

DROP TRIGGER IF EXISTS tr_audit_fees ON public.fees;
CREATE TRIGGER tr_audit_fees
  AFTER INSERT OR UPDATE OR DELETE ON public.fees
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_trigger();

DROP TRIGGER IF EXISTS tr_audit_payments ON public.payments;
CREATE TRIGGER tr_audit_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_trigger();

DROP TRIGGER IF EXISTS tr_audit_profiles ON public.profiles;
CREATE TRIGGER tr_audit_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_trigger();

DROP TRIGGER IF EXISTS tr_audit_students ON public.students;
CREATE TRIGGER tr_audit_students
  AFTER INSERT OR UPDATE OR DELETE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_trigger();

DROP TRIGGER IF EXISTS tr_audit_faculty ON public.faculty;
CREATE TRIGGER tr_audit_faculty
  AFTER INSERT OR UPDATE OR DELETE ON public.faculty
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_trigger();

DROP TRIGGER IF EXISTS tr_audit_attendance ON public.attendance;
CREATE TRIGGER tr_audit_attendance
  AFTER INSERT OR UPDATE OR DELETE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_trigger();

DROP TRIGGER IF EXISTS tr_audit_support_tickets ON public.support_tickets;
CREATE TRIGGER tr_audit_support_tickets
  AFTER INSERT OR UPDATE OR DELETE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_trigger();

DROP TRIGGER IF EXISTS tr_audit_submissions ON public.assignment_submissions;
CREATE TRIGGER tr_audit_submissions
  AFTER INSERT OR UPDATE OR DELETE ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_trigger();

DROP TRIGGER IF EXISTS tr_audit_admissions ON public.admissions_register;
CREATE TRIGGER tr_audit_admissions
  AFTER INSERT OR UPDATE OR DELETE ON public.admissions_register
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_trigger();

DROP TRIGGER IF EXISTS tr_audit_timetable ON public.timetable;
CREATE TRIGGER tr_audit_timetable
  AFTER INSERT OR UPDATE OR DELETE ON public.timetable
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_trigger();

-- ==============================================================================
-- SECTION 3: PAYMENTS IMMUTABILITY & ANTI-TAMPER TRIGGERS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.trig_check_payment_tamper()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Prevent any transition to SUCCESS except via service_role
  IF NEW.status = 'SUCCESS' AND OLD.status IS DISTINCT FROM 'SUCCESS' AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Security Policy: Settled SUCCESS payment status transition is strictly restricted to trusted server-side payment verification.';
  END IF;

  IF OLD.status = 'SUCCESS' THEN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Integrity Violation: Settled payment records are permanently immutable financial records.';
    END IF;

    IF NEW.amount IS DISTINCT FROM OLD.amount THEN
      RAISE EXCEPTION 'Integrity Violation: Settled payment amount cannot be modified (OLD: %, NEW: %).', OLD.amount, NEW.amount;
    END IF;
    IF NEW.fee_id IS DISTINCT FROM OLD.fee_id THEN
      RAISE EXCEPTION 'Integrity Violation: Settled payment fee association cannot be changed.';
    END IF;
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      RAISE EXCEPTION 'Integrity Violation: Settled payment student ownership cannot be changed.';
    END IF;
    IF NEW.receipt_no IS DISTINCT FROM OLD.receipt_no THEN
      RAISE EXCEPTION 'Integrity Violation: Settled receipt number cannot be altered.';
    END IF;
    IF NEW.transaction_ref IS DISTINCT FROM OLD.transaction_ref THEN
      RAISE EXCEPTION 'Integrity Violation: Settled transaction reference cannot be modified.';
    END IF;
    IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
      RAISE EXCEPTION 'Integrity Violation: Settled payment method cannot be altered.';
    END IF;
    IF NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
      RAISE EXCEPTION 'Integrity Violation: Settled payment timestamp cannot be altered.';
    END IF;
    IF NEW.status IS DISTINCT FROM 'SUCCESS' THEN
      RAISE EXCEPTION 'Integrity Violation: Cannot revert or change settled payment status from SUCCESS.';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Integrity Violation: Primary key id cannot be altered.';
    END IF;
    IF NEW.verified_by IS DISTINCT FROM OLD.verified_by THEN
      RAISE EXCEPTION 'Integrity Violation: Settled payment verifier cannot be altered.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_payment_tamper ON public.payments;
CREATE TRIGGER tr_protect_payment_tamper
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.trig_check_payment_tamper();

CREATE OR REPLACE FUNCTION public.trig_check_payment_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'SUCCESS' AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Security Policy: Settled SUCCESS payments can only be created via trusted server-side payment verification.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_payment_insert ON public.payments;
CREATE TRIGGER tr_protect_payment_insert
  BEFORE INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.trig_check_payment_insert();

CREATE OR REPLACE FUNCTION public.trig_check_payment_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'SUCCESS' THEN
    RAISE EXCEPTION 'Integrity Violation: Settled successful payments are immutable permanent financial records and cannot be deleted.';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access Denied: Payment records can only be managed by trusted server services.';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_payment_delete ON public.payments;
CREATE TRIGGER tr_protect_payment_delete
  BEFORE DELETE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.trig_check_payment_delete();

-- ------------------------------------------------------------------------------
-- Authoritative Atomic Online Payment Settlement RPC (Server-Side Execution Only)
-- Serializes concurrent deliveries, validates pending ledger row, prevents overpayment,
-- settles payment record, updates fee balance, and writes financial audit log atomically.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_online_payment_atomic(
  p_transaction_ref TEXT,
  p_amount NUMERIC(10,2),
  p_fee_id UUID,
  p_student_id UUID,
  p_payment_method TEXT DEFAULT 'UPI',
  p_gateway_event TEXT DEFAULT 'payment.captured'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment RECORD;
  v_fee RECORD;
  v_new_paid NUMERIC(10,2);
  v_new_status TEXT;
  v_audit_id UUID;
BEGIN
  -- 1. Authorization: Only service_role backend processes may invoke this settlement RPC
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access Denied: Online payment settlement RPC is strictly restricted to service_role backend callers.';
  END IF;

  -- 2. Concurrency Control: Acquire row-level lock on the pending payment record
  SELECT * INTO v_payment
  FROM public.payments
  WHERE transaction_ref = p_transaction_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment Order Not Found: No payment record exists for transaction_ref %', p_transaction_ref;
  END IF;

  -- 3. Idempotency Check: If already settled, return idempotent success immediately
  IF v_payment.status = 'SUCCESS' THEN
    RETURN jsonb_build_object(
      'status', 'already_processed',
      'message', 'Payment transaction already settled idempotently.',
      'payment_id', v_payment.id,
      'receipt_no', v_payment.receipt_no,
      'transaction_ref', v_payment.transaction_ref,
      'paid_at', v_payment.paid_at
    );
  END IF;

  -- 4. Authoritative Ledger Validation against pending record
  IF v_payment.student_id IS DISTINCT FROM p_student_id THEN
    RAISE EXCEPTION 'Integrity Violation: Payload student_id does not match pending payment record.';
  END IF;

  IF v_payment.fee_id IS DISTINCT FROM p_fee_id THEN
    RAISE EXCEPTION 'Integrity Violation: Payload fee_id does not match pending payment record.';
  END IF;

  IF ABS(v_payment.amount - p_amount) > 0.01 THEN
    RAISE EXCEPTION 'Integrity Violation: Settlement amount % does not match authorized pending amount %.', p_amount, v_payment.amount;
  END IF;

  -- 5. Lock Authoritative Fee Record to serialize balance increments
  SELECT * INTO v_fee
  FROM public.fees
  WHERE id = p_fee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fee Record Not Found: Associated fee_id % does not exist.', p_fee_id;
  END IF;

  IF v_fee.student_id IS DISTINCT FROM p_student_id THEN
    RAISE EXCEPTION 'Integrity Violation: Fee record does not belong to specified student.';
  END IF;

  -- 6. Overpayment Prevention: Reject settlement if new total would exceed billed amount
  IF (v_fee.paid_amount + p_amount) > (v_fee.amount + 0.01) THEN
    RAISE EXCEPTION 'Overpayment Violation: Payment amount % exceeds outstanding fee balance % (Total: %, Already Paid: %).',
      p_amount, (v_fee.amount - v_fee.paid_amount), v_fee.amount, v_fee.paid_amount;
  END IF;

  v_new_paid := v_fee.paid_amount + p_amount;
  IF v_new_paid >= v_fee.amount THEN
    v_new_status := 'paid';
  ELSE
    v_new_status := 'partial';
  END IF;

  -- 7. Atomic Mutation: Settle Payment Record
  -- NOTE: verified_by is UUID FK to profiles(id); for automated gateways, stored as NULL
  UPDATE public.payments
  SET
    status = 'SUCCESS',
    paid_at = now(),
    payment_method = COALESCE(p_payment_method, v_payment.payment_method, 'UPI'),
    verified_by = NULL
  WHERE id = v_payment.id;

  -- 8. Atomic Mutation: Update Fee Balance
  UPDATE public.fees
  SET
    paid_amount = v_new_paid,
    status = v_new_status,
    updated_at = now()
  WHERE id = v_fee.id;

  -- 9. Atomic Audit Record Insertion
  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    new_data,
    timestamp
  ) VALUES (
    NULL,
    'ONLINE_PAYMENT_SETTLED',
    'payments',
    v_payment.id,
    jsonb_build_object(
      'transaction_ref', v_payment.transaction_ref,
      'receipt_no', v_payment.receipt_no,
      'amount', p_amount,
      'fee_id', v_fee.id,
      'student_id', p_student_id,
      'payment_method', COALESCE(p_payment_method, v_payment.payment_method, 'UPI'),
      'status', 'SUCCESS',
      'gateway_event', p_gateway_event,
      'new_fee_status', v_new_status,
      'new_paid_amount', v_new_paid,
      'remaining_balance', (v_fee.amount - v_new_paid)
    ),
    now()
  ) RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'status', 'success',
    'message', 'Payment successfully settled atomically.',
    'payment_id', v_payment.id,
    'receipt_no', v_payment.receipt_no,
    'transaction_ref', v_payment.transaction_ref,
    'amount', p_amount,
    'fee_id', v_fee.id,
    'student_id', p_student_id,
    'new_fee_status', v_new_status,
    'new_paid_amount', v_new_paid,
    'remaining_balance', (v_fee.amount - v_new_paid),
    'audit_id', v_audit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_online_payment_atomic(TEXT, NUMERIC, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_online_payment_atomic(TEXT, NUMERIC, UUID, UUID, TEXT, TEXT) TO service_role;

-- ==============================================================================
-- SECTION 4: PAYMENTS RLS POLICIES (NO DIRECT BROWSER WRITE ACCESS)
-- ==============================================================================

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on payments
DROP POLICY IF EXISTS "sc_payments_read" ON public.payments;
DROP POLICY IF EXISTS "sc_payments_write" ON public.payments;
DROP POLICY IF EXISTS "Allow all" ON public.payments;
DROP POLICY IF EXISTS "payments_select_student" ON public.payments;
DROP POLICY IF EXISTS "payments_select_admin" ON public.payments;
DROP POLICY IF EXISTS "payments_no_client_insert" ON public.payments;
DROP POLICY IF EXISTS "payments_no_client_update" ON public.payments;
DROP POLICY IF EXISTS "payments_no_client_delete" ON public.payments;
DROP POLICY IF EXISTS "payments_admin_all" ON public.payments;

CREATE POLICY "payments_select_student"
  ON public.payments FOR SELECT
  TO authenticated
  USING (student_id = public.current_student_id());

CREATE POLICY "payments_select_admin"
  ON public.payments FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "payments_no_client_insert"
  ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "payments_no_client_update"
  ON public.payments FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "payments_no_client_delete"
  ON public.payments FOR DELETE
  TO authenticated
  USING (false);

-- ==============================================================================
-- SECTION 5: PROFILE PRIVACY & FIELD IMMUTABILITY
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.trig_check_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF NEW.role != OLD.role THEN
      RAISE EXCEPTION 'Privilege Escalation Detected: You cannot modify your own institutional role.';
    END IF;
    IF NEW.email != OLD.email THEN
      RAISE EXCEPTION 'Security Policy: Institutional email address cannot be self-modified.';
    END IF;
    IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
      RAISE EXCEPTION 'Security Policy: Official full name cannot be self-modified.';
    END IF;
    IF NEW.id_number IS DISTINCT FROM OLD.id_number THEN
      RAISE EXCEPTION 'Security Policy: Official ID / Roll Number cannot be self-modified.';
    END IF;
    IF NEW.department IS DISTINCT FROM OLD.department THEN
      RAISE EXCEPTION 'Security Policy: Academic department cannot be self-modified.';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_profile_update ON public.profiles;
CREATE TRIGGER tr_protect_profile_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trig_check_profile_update();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on profiles
DROP POLICY IF EXISTS "sc_profiles_read" ON public.profiles;
DROP POLICY IF EXISTS "sc_profiles_write" ON public.profiles;
DROP POLICY IF EXISTS "Allow all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_faculty_assigned" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_select_faculty_assigned"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    public.is_faculty() AND (
      id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.students s
        JOIN public.enrollments e ON e.student_id = s.id
        JOIN public.classes c ON c.id = e.class_id
        WHERE s.profile_id = profiles.id
          AND c.faculty_id = public.current_faculty_id()
          AND e.status != 'dropped'
      )
    )
  );

CREATE POLICY "profiles_select_admin"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "profiles_delete_admin"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ==============================================================================
-- SECTION 6: ASSIGNMENT SUBMISSION LIFECYCLE & INTEGRITY
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.tr_protect_submission_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.assignment_id <> OLD.assignment_id THEN
    RAISE EXCEPTION 'Cannot reassign submission to another assignment.';
  END IF;

  IF NEW.student_id <> OLD.student_id THEN
    RAISE EXCEPTION 'Cannot transfer submission ownership.';
  END IF;

  IF OLD.status = 'graded' AND NOT (public.is_faculty() OR public.is_admin()) THEN
    RAISE EXCEPTION 'Graded submissions are finalized and cannot be modified by students.';
  END IF;

  IF NOT (public.is_faculty() OR public.is_admin()) THEN
    IF NEW.status = 'graded' AND OLD.status <> 'graded' THEN
      RAISE EXCEPTION 'Students cannot mark submissions as graded.';
    END IF;
    IF NEW.marks_obtained IS DISTINCT FROM OLD.marks_obtained THEN
      RAISE EXCEPTION 'Students cannot assign or modify marks_obtained.';
    END IF;
    IF NEW.feedback IS DISTINCT FROM OLD.feedback THEN
      RAISE EXCEPTION 'Students cannot alter instructor feedback.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_check_submission_lifecycle ON public.assignment_submissions;
CREATE TRIGGER trig_check_submission_lifecycle
  BEFORE UPDATE ON public.assignment_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_protect_submission_lifecycle();

ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on assignment_submissions
DROP POLICY IF EXISTS "sc_submissions_read" ON public.assignment_submissions;
DROP POLICY IF EXISTS "sc_submissions_write" ON public.assignment_submissions;
DROP POLICY IF EXISTS "sc_assignment_submissions_read" ON public.assignment_submissions;
DROP POLICY IF EXISTS "sc_assignment_submissions_write" ON public.assignment_submissions;
DROP POLICY IF EXISTS "Allow all" ON public.assignment_submissions;
DROP POLICY IF EXISTS "submissions_select_student" ON public.assignment_submissions;
DROP POLICY IF EXISTS "submissions_select_faculty" ON public.assignment_submissions;
DROP POLICY IF EXISTS "submissions_select_admin" ON public.assignment_submissions;
DROP POLICY IF EXISTS "submissions_insert_student" ON public.assignment_submissions;
DROP POLICY IF EXISTS "submissions_update_student" ON public.assignment_submissions;
DROP POLICY IF EXISTS "submissions_update_faculty" ON public.assignment_submissions;
DROP POLICY IF EXISTS "submissions_grade_faculty" ON public.assignment_submissions;
DROP POLICY IF EXISTS "submissions_admin_all" ON public.assignment_submissions;

CREATE POLICY "submissions_select_student"
  ON public.assignment_submissions FOR SELECT
  TO authenticated
  USING (student_id = public.current_student_id());

CREATE POLICY "submissions_select_faculty"
  ON public.assignment_submissions FOR SELECT
  TO authenticated
  USING (
    public.is_faculty() AND
    EXISTS (
      SELECT 1 FROM public.assignments a
      JOIN public.classes c ON c.id = a.class_id
      WHERE a.id = assignment_submissions.assignment_id
        AND c.faculty_id = public.current_faculty_id()
    )
  );

CREATE POLICY "submissions_select_admin"
  ON public.assignment_submissions FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "submissions_insert_student"
  ON public.assignment_submissions FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id = public.current_student_id() AND
    marks_obtained IS NULL AND
    feedback IS NULL AND
    status = 'submitted' AND
    EXISTS (
      SELECT 1 FROM public.assignments a
      JOIN public.enrollments e ON e.class_id = a.class_id
      WHERE a.id = assignment_submissions.assignment_id
        AND e.student_id = public.current_student_id()
        AND e.status = 'enrolled'
    )
  );

CREATE POLICY "submissions_update_student"
  ON public.assignment_submissions FOR UPDATE
  TO authenticated
  USING (
    student_id = public.current_student_id() AND
    status != 'graded'
  )
  WITH CHECK (
    student_id = public.current_student_id() AND
    marks_obtained IS NULL AND
    feedback IS NULL AND
    status IN ('submitted', 'resubmitted', 'late') AND
    EXISTS (
      SELECT 1 FROM public.assignments a
      JOIN public.enrollments e ON e.class_id = a.class_id
      WHERE a.id = assignment_submissions.assignment_id
        AND e.student_id = public.current_student_id()
        AND e.status = 'enrolled'
    )
  );

CREATE POLICY "submissions_update_faculty"
  ON public.assignment_submissions FOR UPDATE
  TO authenticated
  USING (
    public.is_faculty() AND
    EXISTS (
      SELECT 1 FROM public.assignments a
      JOIN public.classes c ON c.id = a.class_id
      WHERE a.id = assignment_submissions.assignment_id
        AND c.faculty_id = public.current_faculty_id()
    )
  )
  WITH CHECK (
    public.is_faculty() AND
    EXISTS (
      SELECT 1 FROM public.assignments a
      JOIN public.classes c ON c.id = a.class_id
      WHERE a.id = assignment_submissions.assignment_id
        AND c.faculty_id = public.current_faculty_id()
    )
  );

-- ==============================================================================
-- SECTION 7: RESTRICTED ASSIGNMENTS ACCESS
-- ==============================================================================

ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on assignments
DROP POLICY IF EXISTS "sc_assignments_read" ON public.assignments;
DROP POLICY IF EXISTS "sc_assignments_write" ON public.assignments;
DROP POLICY IF EXISTS "Allow all" ON public.assignments;
DROP POLICY IF EXISTS "assignments_select_all" ON public.assignments;
DROP POLICY IF EXISTS "assignments_select_authenticated" ON public.assignments;
DROP POLICY IF EXISTS "assignments_select_student" ON public.assignments;
DROP POLICY IF EXISTS "assignments_select_faculty" ON public.assignments;
DROP POLICY IF EXISTS "assignments_select_admin" ON public.assignments;
DROP POLICY IF EXISTS "assignments_insert_faculty" ON public.assignments;
DROP POLICY IF EXISTS "assignments_update_faculty" ON public.assignments;
DROP POLICY IF EXISTS "assignments_delete_faculty" ON public.assignments;
DROP POLICY IF EXISTS "assignments_admin_all" ON public.assignments;

CREATE POLICY "assignments_select_student"
  ON public.assignments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.class_id = assignments.class_id
        AND e.student_id = public.current_student_id()
        AND e.status != 'dropped'
    )
  );

CREATE POLICY "assignments_select_faculty"
  ON public.assignments FOR SELECT
  TO authenticated
  USING (
    public.is_faculty() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = assignments.class_id
        AND c.faculty_id = public.current_faculty_id()
    )
  );

CREATE POLICY "assignments_select_admin"
  ON public.assignments FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "assignments_insert_faculty"
  ON public.assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_faculty() AND
    faculty_id = public.current_faculty_id() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = assignments.class_id AND c.faculty_id = public.current_faculty_id()
    )
  );

CREATE POLICY "assignments_update_faculty"
  ON public.assignments FOR UPDATE
  TO authenticated
  USING (
    public.is_faculty() AND
    faculty_id = public.current_faculty_id() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = assignments.class_id AND c.faculty_id = public.current_faculty_id()
    )
  )
  WITH CHECK (
    public.is_faculty() AND
    faculty_id = public.current_faculty_id() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = assignments.class_id AND c.faculty_id = public.current_faculty_id()
    )
  );

CREATE POLICY "assignments_delete_faculty"
  ON public.assignments FOR DELETE
  TO authenticated
  USING (
    public.is_faculty() AND
    faculty_id = public.current_faculty_id() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = assignments.class_id AND c.faculty_id = public.current_faculty_id()
    )
  );

CREATE POLICY "assignments_admin_all"
  ON public.assignments FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ==============================================================================
-- SECTION 8: HARDENED ATTENDANCE & MARKS (SCOPED VIA ENROLLMENTS & IDENTITY LOCKED)
-- ==============================================================================

-- 8.1 ATTENDANCE IDENTITY PROTECTION TRIGGER
CREATE OR REPLACE FUNCTION public.trig_protect_attendance_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      RAISE EXCEPTION 'Integrity Violation: Cannot change student_id on an existing attendance record.';
    END IF;
    IF NEW.class_id IS DISTINCT FROM OLD.class_id THEN
      RAISE EXCEPTION 'Integrity Violation: Cannot change class_id on an existing attendance record.';
    END IF;
    IF NEW.subject_id IS DISTINCT FROM OLD.subject_id THEN
      RAISE EXCEPTION 'Integrity Violation: Cannot change subject_id on an existing attendance record.';
    END IF;
    IF NEW.faculty_id IS DISTINCT FROM OLD.faculty_id THEN
      RAISE EXCEPTION 'Integrity Violation: Cannot transfer attendance faculty ownership.';
    END IF;
    IF NEW.date IS DISTINCT FROM OLD.date THEN
      RAISE EXCEPTION 'Integrity Violation: Cannot alter attendance date.';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Integrity Violation: Cannot alter attendance record primary key.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_attendance_identity ON public.attendance;
CREATE TRIGGER tr_protect_attendance_identity
  BEFORE UPDATE ON public.attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.trig_protect_attendance_identity();

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on attendance
DROP POLICY IF EXISTS "sc_attendance_read" ON public.attendance;
DROP POLICY IF EXISTS "sc_attendance_write" ON public.attendance;
DROP POLICY IF EXISTS "Allow all" ON public.attendance;
DROP POLICY IF EXISTS "attendance_select_student" ON public.attendance;
DROP POLICY IF EXISTS "attendance_select_faculty" ON public.attendance;
DROP POLICY IF EXISTS "attendance_select_admin" ON public.attendance;
DROP POLICY IF EXISTS "attendance_insert_faculty" ON public.attendance;
DROP POLICY IF EXISTS "attendance_update_faculty" ON public.attendance;
DROP POLICY IF EXISTS "attendance_admin_all" ON public.attendance;

CREATE POLICY "attendance_select_student"
  ON public.attendance FOR SELECT
  TO authenticated
  USING (student_id = public.current_student_id());

CREATE POLICY "attendance_select_faculty"
  ON public.attendance FOR SELECT
  TO authenticated
  USING (
    public.is_faculty() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = attendance.class_id AND c.faculty_id = public.current_faculty_id()
    )
  );

CREATE POLICY "attendance_select_admin"
  ON public.attendance FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "attendance_insert_faculty"
  ON public.attendance FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_faculty() AND
    faculty_id = public.current_faculty_id() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = attendance.class_id AND c.faculty_id = public.current_faculty_id()
    ) AND
    EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.student_id = attendance.student_id
        AND e.class_id = attendance.class_id
        AND e.status = 'enrolled'
    )
  );

CREATE POLICY "attendance_update_faculty"
  ON public.attendance FOR UPDATE
  TO authenticated
  USING (
    public.is_faculty() AND
    faculty_id = public.current_faculty_id() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = attendance.class_id AND c.faculty_id = public.current_faculty_id()
    ) AND
    EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.student_id = attendance.student_id
        AND e.class_id = attendance.class_id
        AND e.status = 'enrolled'
    )
  )
  WITH CHECK (
    public.is_faculty() AND
    faculty_id = public.current_faculty_id() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = attendance.class_id AND c.faculty_id = public.current_faculty_id()
    ) AND
    EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.student_id = attendance.student_id
        AND e.class_id = attendance.class_id
        AND e.status = 'enrolled'
    )
  );

CREATE POLICY "attendance_admin_all"
  ON public.attendance FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 8.2 MARKS IDENTITY PROTECTION TRIGGER
CREATE OR REPLACE FUNCTION public.trig_protect_marks_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      RAISE EXCEPTION 'Integrity Violation: Cannot change student_id on an existing marks record.';
    END IF;
    IF NEW.exam_id IS DISTINCT FROM OLD.exam_id THEN
      RAISE EXCEPTION 'Integrity Violation: Cannot change exam_id on an existing marks record.';
    END IF;
    IF NEW.subject_id IS DISTINCT FROM OLD.subject_id THEN
      RAISE EXCEPTION 'Integrity Violation: Cannot change subject_id on an existing marks record.';
    END IF;
    IF NEW.entered_by IS DISTINCT FROM OLD.entered_by THEN
      RAISE EXCEPTION 'Integrity Violation: Cannot transfer marks entry ownership.';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Integrity Violation: Cannot alter marks record primary key.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_marks_identity ON public.marks;
CREATE TRIGGER tr_protect_marks_identity
  BEFORE UPDATE ON public.marks
  FOR EACH ROW
  EXECUTE FUNCTION public.trig_protect_marks_identity();

ALTER TABLE public.marks ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on marks
DROP POLICY IF EXISTS "sc_marks_read" ON public.marks;
DROP POLICY IF EXISTS "sc_marks_write" ON public.marks;
DROP POLICY IF EXISTS "Allow all" ON public.marks;
DROP POLICY IF EXISTS "marks_select_student" ON public.marks;
DROP POLICY IF EXISTS "marks_select_faculty" ON public.marks;
DROP POLICY IF EXISTS "marks_select_admin" ON public.marks;
DROP POLICY IF EXISTS "marks_insert_faculty" ON public.marks;
DROP POLICY IF EXISTS "marks_update_faculty" ON public.marks;
DROP POLICY IF EXISTS "marks_admin_all" ON public.marks;

CREATE POLICY "marks_select_student"
  ON public.marks FOR SELECT
  TO authenticated
  USING (student_id = public.current_student_id());

CREATE POLICY "marks_select_faculty"
  ON public.marks FOR SELECT
  TO authenticated
  USING (
    public.is_faculty() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      JOIN public.exams ex ON ex.class_id = c.id
      JOIN public.enrollments e ON e.class_id = c.id
      WHERE ex.id = marks.exam_id
        AND ex.subject_id = marks.subject_id
        AND c.faculty_id = public.current_faculty_id()
        AND e.student_id = marks.student_id
        AND e.status != 'dropped'
    )
  );

CREATE POLICY "marks_select_admin"
  ON public.marks FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "marks_insert_faculty"
  ON public.marks FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_faculty() AND
    entered_by = public.current_faculty_id() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      JOIN public.exams ex ON ex.class_id = c.id
      WHERE ex.id = marks.exam_id
        AND ex.subject_id = marks.subject_id
        AND c.faculty_id = public.current_faculty_id()
    ) AND
    EXISTS (
      SELECT 1 FROM public.enrollments e
      JOIN public.exams ex ON ex.id = marks.exam_id
      WHERE e.student_id = marks.student_id
        AND e.class_id = ex.class_id
        AND e.status = 'enrolled'
    )
  );

CREATE POLICY "marks_update_faculty"
  ON public.marks FOR UPDATE
  TO authenticated
  USING (
    public.is_faculty() AND
    entered_by = public.current_faculty_id() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      JOIN public.exams ex ON ex.class_id = c.id
      WHERE ex.id = marks.exam_id
        AND ex.subject_id = marks.subject_id
        AND c.faculty_id = public.current_faculty_id()
    ) AND
    EXISTS (
      SELECT 1 FROM public.enrollments e
      JOIN public.exams ex ON ex.id = marks.exam_id
      WHERE e.student_id = marks.student_id
        AND e.class_id = ex.class_id
        AND e.status = 'enrolled'
    )
  )
  WITH CHECK (
    public.is_faculty() AND
    entered_by = public.current_faculty_id() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      JOIN public.exams ex ON ex.class_id = c.id
      WHERE ex.id = marks.exam_id
        AND ex.subject_id = marks.subject_id
        AND c.faculty_id = public.current_faculty_id()
    ) AND
    EXISTS (
      SELECT 1 FROM public.enrollments e
      JOIN public.exams ex ON ex.id = marks.exam_id
      WHERE e.student_id = marks.student_id
        AND e.class_id = ex.class_id
        AND e.status = 'enrolled'
    )
  );

CREATE POLICY "marks_admin_all"
  ON public.marks FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ==============================================================================
-- SECTION 9: FEES RLS POLICIES (STUDENT PRIVATE & ADMIN MANAGEMENT)
-- ==============================================================================

ALTER TABLE public.fees ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on fees
DROP POLICY IF EXISTS "sc_fees_read" ON public.fees;
DROP POLICY IF EXISTS "sc_fees_write" ON public.fees;
DROP POLICY IF EXISTS "Allow all" ON public.fees;
DROP POLICY IF EXISTS "fees_select_student" ON public.fees;
DROP POLICY IF EXISTS "fees_admin_all" ON public.fees;

CREATE POLICY "fees_select_student"
  ON public.fees FOR SELECT
  TO authenticated
  USING (student_id = public.current_student_id());

CREATE POLICY "fees_admin_all"
  ON public.fees FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ==============================================================================
-- SECTION 10: STUDENTS & ENROLLMENTS PRIVACY & SCOPING
-- ==============================================================================

-- 10.1 STUDENTS TABLE
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on students
DROP POLICY IF EXISTS "sc_students_read" ON public.students;
DROP POLICY IF EXISTS "sc_students_write" ON public.students;
DROP POLICY IF EXISTS "Allow all" ON public.students;
DROP POLICY IF EXISTS "students_select_own" ON public.students;
DROP POLICY IF EXISTS "students_select_faculty" ON public.students;
DROP POLICY IF EXISTS "students_admin_all" ON public.students;

CREATE POLICY "students_select_own"
  ON public.students FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "students_select_faculty"
  ON public.students FOR SELECT
  TO authenticated
  USING (
    public.is_faculty() AND
    EXISTS (
      SELECT 1 FROM public.enrollments e
      JOIN public.classes c ON c.id = e.class_id
      WHERE e.student_id = students.id
        AND c.faculty_id = public.current_faculty_id()
        AND e.status = 'enrolled'
    )
  );

-- Duty-Restricted Student Roster RPC: Returns only academic fields required for faculty duties
-- Omits sensitive PII (guardian_phone, guardian_name, address, date_of_birth) and financial dues
CREATE OR REPLACE FUNCTION public.get_faculty_class_roster(p_class_id UUID)
RETURNS TABLE (
  student_id UUID,
  student_code TEXT,
  roll_number TEXT,
  full_name TEXT,
  avatar_url TEXT,
  enrollment_status TEXT,
  attendance_percentage NUMERIC(5,2),
  cgpa NUMERIC(4,2),
  year INT,
  semester INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (
    public.is_admin() OR
    (public.is_faculty() AND EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = p_class_id AND c.faculty_id = public.current_faculty_id()
    ))
  ) THEN
    RAISE EXCEPTION 'Access Denied: You are not assigned to instruct this class roster.';
  END IF;

  RETURN QUERY
  SELECT
    s.id AS student_id,
    s.student_id AS student_code,
    s.roll_number,
    p.full_name,
    p.avatar_url,
    e.status AS enrollment_status,
    s.attendance_percentage,
    s.cgpa,
    s.year,
    s.semester
  FROM public.enrollments e
  JOIN public.students s ON s.id = e.student_id
  JOIN public.profiles p ON p.id = s.profile_id
  WHERE e.class_id = p_class_id
  ORDER BY s.roll_number ASC;
END;
$$;

CREATE POLICY "students_admin_all"
  ON public.students FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 10.2 ENROLLMENTS TABLE
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on enrollments
DROP POLICY IF EXISTS "sc_enrollments_read" ON public.enrollments;
DROP POLICY IF EXISTS "sc_enrollments_write" ON public.enrollments;
DROP POLICY IF EXISTS "Allow all" ON public.enrollments;
DROP POLICY IF EXISTS "enrollments_select_student" ON public.enrollments;
DROP POLICY IF EXISTS "enrollments_select_faculty" ON public.enrollments;
DROP POLICY IF EXISTS "enrollments_admin_all" ON public.enrollments;

CREATE POLICY "enrollments_select_student"
  ON public.enrollments FOR SELECT
  TO authenticated
  USING (student_id = public.current_student_id());

CREATE POLICY "enrollments_select_faculty"
  ON public.enrollments FOR SELECT
  TO authenticated
  USING (
    public.is_faculty() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = enrollments.class_id
        AND c.faculty_id = public.current_faculty_id()
    )
  );

CREATE POLICY "enrollments_admin_all"
  ON public.enrollments FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ==============================================================================
-- SECTION 11: EXAMS & TIMETABLE SCOPING
-- ==============================================================================

-- 11.1 EXAMS TABLE
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on exams
DROP POLICY IF EXISTS "sc_exams_read" ON public.exams;
DROP POLICY IF EXISTS "sc_exams_write" ON public.exams;
DROP POLICY IF EXISTS "Allow all" ON public.exams;
DROP POLICY IF EXISTS "exams_select_student" ON public.exams;
DROP POLICY IF EXISTS "exams_select_faculty" ON public.exams;
DROP POLICY IF EXISTS "exams_admin_all" ON public.exams;

CREATE POLICY "exams_select_student"
  ON public.exams FOR SELECT
  TO authenticated
  USING (
    published = true AND
    EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.class_id = exams.class_id
        AND e.student_id = public.current_student_id()
        AND e.status != 'dropped'
    )
  );

CREATE POLICY "exams_select_faculty"
  ON public.exams FOR SELECT
  TO authenticated
  USING (
    public.is_faculty() AND
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = exams.class_id
        AND c.faculty_id = public.current_faculty_id()
    )
  );

CREATE POLICY "exams_admin_all"
  ON public.exams FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 11.2 TIMETABLE TABLE
ALTER TABLE public.timetable ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on timetable
DROP POLICY IF EXISTS "sc_timetable_read" ON public.timetable;
DROP POLICY IF EXISTS "sc_timetable_write" ON public.timetable;
DROP POLICY IF EXISTS "Allow all" ON public.timetable;
DROP POLICY IF EXISTS "timetable_select_student" ON public.timetable;
DROP POLICY IF EXISTS "timetable_select_faculty" ON public.timetable;
DROP POLICY IF EXISTS "timetable_select_authenticated" ON public.timetable;
DROP POLICY IF EXISTS "timetable_admin_all" ON public.timetable;

CREATE POLICY "timetable_select_authenticated"
  ON public.timetable FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "timetable_admin_all"
  ON public.timetable FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ==============================================================================
-- SECTION 12: ACADEMIC CATALOG REFERENCE TABLES (DEPARTMENTS, COURSES, SUBJECTS, CLASSES, FACULTY)
-- ==============================================================================

-- 12.1 DEPARTMENTS
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sc_departments_read" ON public.departments;
DROP POLICY IF EXISTS "sc_departments_write" ON public.departments;
DROP POLICY IF EXISTS "Allow all" ON public.departments;
DROP POLICY IF EXISTS "departments_select_authenticated" ON public.departments;
DROP POLICY IF EXISTS "departments_admin_all" ON public.departments;

CREATE POLICY "departments_select_authenticated"
  ON public.departments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "departments_admin_all"
  ON public.departments FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 12.2 COURSES
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sc_courses_read" ON public.courses;
DROP POLICY IF EXISTS "sc_courses_write" ON public.courses;
DROP POLICY IF EXISTS "Allow all" ON public.courses;
DROP POLICY IF EXISTS "courses_select_authenticated" ON public.courses;
DROP POLICY IF EXISTS "courses_admin_all" ON public.courses;

CREATE POLICY "courses_select_authenticated"
  ON public.courses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "courses_admin_all"
  ON public.courses FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 12.3 SUBJECTS
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sc_subjects_read" ON public.subjects;
DROP POLICY IF EXISTS "sc_subjects_write" ON public.subjects;
DROP POLICY IF EXISTS "Allow all" ON public.subjects;
DROP POLICY IF EXISTS "subjects_select_authenticated" ON public.subjects;
DROP POLICY IF EXISTS "subjects_admin_all" ON public.subjects;

CREATE POLICY "subjects_select_authenticated"
  ON public.subjects FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "subjects_admin_all"
  ON public.subjects FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 12.4 CLASSES
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sc_classes_read" ON public.classes;
DROP POLICY IF EXISTS "sc_classes_write" ON public.classes;
DROP POLICY IF EXISTS "Allow all" ON public.classes;
DROP POLICY IF EXISTS "classes_select_authenticated" ON public.classes;
DROP POLICY IF EXISTS "classes_admin_all" ON public.classes;

CREATE POLICY "classes_select_authenticated"
  ON public.classes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "classes_admin_all"
  ON public.classes FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 12.5 FACULTY DIRECTORY
ALTER TABLE public.faculty ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sc_faculty_read" ON public.faculty;
DROP POLICY IF EXISTS "sc_faculty_write" ON public.faculty;
DROP POLICY IF EXISTS "Allow all" ON public.faculty;
DROP POLICY IF EXISTS "faculty_select_authenticated" ON public.faculty;
DROP POLICY IF EXISTS "faculty_select_scoped" ON public.faculty;
DROP POLICY IF EXISTS "faculty_update_own" ON public.faculty;
DROP POLICY IF EXISTS "faculty_admin_all" ON public.faculty;

CREATE POLICY "faculty_select_scoped"
  ON public.faculty FOR SELECT
  TO authenticated
  USING (
    profile_id = auth.uid() OR
    public.is_admin() OR
    EXISTS (
      SELECT 1 FROM public.classes c
      JOIN public.enrollments e ON e.class_id = c.id
      WHERE c.faculty_id = faculty.id
        AND e.student_id = public.current_student_id()
        AND e.status = 'enrolled'
    ) OR
    (
      public.is_faculty() AND
      department_id IS NOT NULL AND
      department_id = (SELECT f2.department_id FROM public.faculty f2 WHERE f2.profile_id = auth.uid())
    )
  );

CREATE POLICY "faculty_update_own"
  ON public.faculty FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "faculty_admin_all"
  ON public.faculty FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ==============================================================================
-- SECTION 13: SUPPORT TICKETS, EVENT REGISTRATIONS & NOTIFICATIONS
-- ==============================================================================

-- 13.1 SUPPORT TICKETS
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on support_tickets
DROP POLICY IF EXISTS "sc_support_tickets_read" ON public.support_tickets;
DROP POLICY IF EXISTS "sc_support_tickets_write" ON public.support_tickets;
DROP POLICY IF EXISTS "sc_tickets_read" ON public.support_tickets;
DROP POLICY IF EXISTS "sc_tickets_write" ON public.support_tickets;
DROP POLICY IF EXISTS "Allow all" ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_select_own" ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_select_admin" ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_select_authorized" ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_insert_own" ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_update_own" ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_update_admin" ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_admin_all" ON public.support_tickets;

CREATE POLICY "tickets_select_authorized"
  ON public.support_tickets FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR
    assigned_to = auth.uid() OR
    public.is_admin()
  );

CREATE POLICY "tickets_insert_own"
  ON public.support_tickets FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "tickets_update_own"
  ON public.support_tickets FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND status = 'Open')
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "tickets_update_admin"
  ON public.support_tickets FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 13.2 EVENT REGISTRATIONS
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on event_registrations
DROP POLICY IF EXISTS "sc_event_registrations_read" ON public.event_registrations;
DROP POLICY IF EXISTS "sc_event_registrations_write" ON public.event_registrations;
DROP POLICY IF EXISTS "sc_registrations_read" ON public.event_registrations;
DROP POLICY IF EXISTS "sc_registrations_write" ON public.event_registrations;
DROP POLICY IF EXISTS "Allow all" ON public.event_registrations;
DROP POLICY IF EXISTS "registrations_select_own" ON public.event_registrations;
DROP POLICY IF EXISTS "registrations_select_admin" ON public.event_registrations;
DROP POLICY IF EXISTS "registrations_insert_own" ON public.event_registrations;
DROP POLICY IF EXISTS "registrations_delete_own" ON public.event_registrations;
DROP POLICY IF EXISTS "registrations_admin_all" ON public.event_registrations;

CREATE POLICY "registrations_select_own"
  ON public.event_registrations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "registrations_select_admin"
  ON public.event_registrations FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "registrations_insert_own"
  ON public.event_registrations FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "registrations_delete_own"
  ON public.event_registrations FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- 13.3 EVENTS CATALOG
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sc_events_read" ON public.events;
DROP POLICY IF EXISTS "sc_events_write" ON public.events;
DROP POLICY IF EXISTS "Allow all" ON public.events;
DROP POLICY IF EXISTS "events_select_authenticated" ON public.events;
DROP POLICY IF EXISTS "events_admin_all" ON public.events;

CREATE POLICY "events_select_authenticated"
  ON public.events FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "events_admin_all"
  ON public.events FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 13.4 NOTIFICATIONS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on notifications
DROP POLICY IF EXISTS "sc_notifications_read" ON public.notifications;
DROP POLICY IF EXISTS "sc_notifications_write" ON public.notifications;
DROP POLICY IF EXISTS "Allow all" ON public.notifications;
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_read_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_admin" ON public.notifications;
DROP POLICY IF EXISTS "notifications_admin_all" ON public.notifications;

CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications_update_read_own"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_insert_admin"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.trig_check_notification_tamper()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF NEW.title != OLD.title OR NEW.message != OLD.message OR NEW.user_id != OLD.user_id OR NEW.type != OLD.type THEN
      RAISE EXCEPTION 'Notification content cannot be altered by users.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_notification_tamper ON public.notifications;
CREATE TRIGGER tr_protect_notification_tamper
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.trig_check_notification_tamper();

-- ==============================================================================
-- SECTION 14: ANNOUNCEMENTS (DEPARTMENTAL & AUDIENCE SCOPED)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.trig_protect_announcement_tamper()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Strict attribution protection: author_id and primary key can NEVER be altered,
  -- ensuring that when admins edit notices, original author attribution remains permanently immutable.
  IF NEW.author_id IS DISTINCT FROM OLD.author_id THEN
    RAISE EXCEPTION 'Integrity Violation: Cannot alter announcement author attribution.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Integrity Violation: Cannot alter announcement primary key.';
  END IF;

  IF NOT public.is_admin() THEN
    IF NEW.target_audience = 'all' AND OLD.target_audience != 'all' THEN
      RAISE EXCEPTION 'Privilege Violation: Faculty cannot promote departmental notice to campus-wide announcement.';
    END IF;
    IF NEW.department_id IS DISTINCT FROM OLD.department_id THEN
      RAISE EXCEPTION 'Privilege Violation: Faculty cannot reassign announcement to another department.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_announcement_tamper ON public.announcements;
CREATE TRIGGER tr_protect_announcement_tamper
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.trig_protect_announcement_tamper();

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and live policies on announcements
DROP POLICY IF EXISTS "sc_announcements_read" ON public.announcements;
DROP POLICY IF EXISTS "sc_announcements_write" ON public.announcements;
DROP POLICY IF EXISTS "Allow all" ON public.announcements;
DROP POLICY IF EXISTS "announcements_select_student" ON public.announcements;
DROP POLICY IF EXISTS "announcements_select_faculty" ON public.announcements;
DROP POLICY IF EXISTS "announcements_select_authenticated" ON public.announcements;
DROP POLICY IF EXISTS "announcements_insert_faculty" ON public.announcements;
DROP POLICY IF EXISTS "announcements_update_faculty" ON public.announcements;
DROP POLICY IF EXISTS "announcements_delete_admin" ON public.announcements;
DROP POLICY IF EXISTS "announcements_admin_all" ON public.announcements;

-- Select policy: Admins read ALL announcements (drafts, scheduled, expired);
-- Authors can review own drafts; ordinary students and faculty require published = true and valid window
CREATE POLICY "announcements_select_authenticated"
  ON public.announcements FOR SELECT
  TO authenticated
  USING (
    public.is_admin() OR
    author_id = auth.uid() OR
    (
      published = true AND
      (publish_date IS NULL OR publish_date <= now()) AND
      (expiry_date IS NULL OR expiry_date >= now()) AND
      (
        target_audience = 'all' OR
        (target_audience = 'student' AND public.current_student_id() IS NOT NULL) OR
        (target_audience = 'faculty' AND public.is_faculty())
      )
    )
  );

-- Insert policy: Admins can publish any announcement; faculty restricted to own department and non-'all' audience
CREATE POLICY "announcements_insert_faculty"
  ON public.announcements FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.is_admin() AND author_id = auth.uid()) OR
    (
      public.is_faculty() AND
      author_id = auth.uid() AND
      target_audience IN ('student', 'faculty') AND
      target_audience != 'all' AND
      department_id = (SELECT department_id FROM public.faculty WHERE profile_id = auth.uid())
    )
  );

-- Update policy: Admins can update any announcement (preserving author attribution); faculty can update own notices
CREATE POLICY "announcements_update_faculty"
  ON public.announcements FOR UPDATE
  TO authenticated
  USING (
    author_id = auth.uid() OR public.is_admin()
  )
  WITH CHECK (
    public.is_admin() OR
    (
      public.is_faculty() AND
      author_id = auth.uid() AND
      target_audience IN ('student', 'faculty') AND
      target_audience != 'all' AND
      department_id = (SELECT department_id FROM public.faculty WHERE profile_id = auth.uid())
    )
  );

CREATE POLICY "announcements_delete_admin"
  ON public.announcements FOR DELETE
  TO authenticated
  USING (public.is_admin() OR (public.is_faculty() AND author_id = auth.uid()));

-- ==============================================================================
-- SECTION 15: COMPLEMENTARY MODULES (RESOURCES, LOST & FOUND, PLACEMENTS, ADMISSIONS)
-- ==============================================================================

-- 15.1 RESOURCES
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sc_resources_read" ON public.resources;
DROP POLICY IF EXISTS "sc_resources_write" ON public.resources;
DROP POLICY IF EXISTS "Allow all" ON public.resources;
DROP POLICY IF EXISTS "resources_select_authenticated" ON public.resources;
DROP POLICY IF EXISTS "resources_insert_faculty" ON public.resources;
DROP POLICY IF EXISTS "resources_update_faculty" ON public.resources;
DROP POLICY IF EXISTS "resources_delete_faculty" ON public.resources;
DROP POLICY IF EXISTS "resources_admin_all" ON public.resources;

CREATE POLICY "resources_select_authenticated"
  ON public.resources FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "resources_insert_faculty"
  ON public.resources FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.is_faculty() OR public.is_admin()) AND
    uploaded_by = auth.uid()
  );

CREATE POLICY "resources_update_faculty"
  ON public.resources FOR UPDATE
  TO authenticated
  USING (
    uploaded_by = auth.uid() OR public.is_admin()
  )
  WITH CHECK (
    uploaded_by = auth.uid() OR public.is_admin()
  );

CREATE POLICY "resources_delete_faculty"
  ON public.resources FOR DELETE
  TO authenticated
  USING (
    uploaded_by = auth.uid() OR public.is_admin()
  );

-- 15.2 LOST & FOUND
ALTER TABLE public.lost_found ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sc_lost_found_read" ON public.lost_found;
DROP POLICY IF EXISTS "sc_lost_found_write" ON public.lost_found;
DROP POLICY IF EXISTS "Allow all" ON public.lost_found;
DROP POLICY IF EXISTS "lost_found_select_authenticated" ON public.lost_found;
DROP POLICY IF EXISTS "lost_found_insert_authenticated" ON public.lost_found;
DROP POLICY IF EXISTS "lost_found_update_reporter" ON public.lost_found;
DROP POLICY IF EXISTS "lost_found_delete_reporter" ON public.lost_found;
DROP POLICY IF EXISTS "lost_found_admin_all" ON public.lost_found;

CREATE POLICY "lost_found_select_authenticated"
  ON public.lost_found FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "lost_found_insert_authenticated"
  ON public.lost_found FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "lost_found_update_reporter"
  ON public.lost_found FOR UPDATE
  TO authenticated
  USING (reporter_id = auth.uid() OR public.is_admin())
  WITH CHECK (reporter_id = auth.uid() OR public.is_admin());

CREATE POLICY "lost_found_delete_reporter"
  ON public.lost_found FOR DELETE
  TO authenticated
  USING (reporter_id = auth.uid() OR public.is_admin());

-- 15.3 PLACEMENTS & PLACEMENT APPLICATIONS
ALTER TABLE public.placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.placement_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sc_placements_read" ON public.placements;
DROP POLICY IF EXISTS "sc_placements_write" ON public.placements;
DROP POLICY IF EXISTS "Allow all" ON public.placements;
DROP POLICY IF EXISTS "placements_select_authenticated" ON public.placements;
DROP POLICY IF EXISTS "placements_admin_all" ON public.placements;

CREATE POLICY "placements_select_authenticated"
  ON public.placements FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "placements_admin_all"
  ON public.placements FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "sc_placement_applications_read" ON public.placement_applications;
DROP POLICY IF EXISTS "sc_placement_applications_write" ON public.placement_applications;
DROP POLICY IF EXISTS "sc_applications_read" ON public.placement_applications;
DROP POLICY IF EXISTS "sc_applications_write" ON public.placement_applications;
DROP POLICY IF EXISTS "Allow all" ON public.placement_applications;
DROP POLICY IF EXISTS "applications_select_student" ON public.placement_applications;
DROP POLICY IF EXISTS "applications_select_admin" ON public.placement_applications;
DROP POLICY IF EXISTS "applications_insert_student" ON public.placement_applications;
DROP POLICY IF EXISTS "applications_delete_student" ON public.placement_applications;
DROP POLICY IF EXISTS "applications_admin_all" ON public.placement_applications;

CREATE POLICY "applications_select_student"
  ON public.placement_applications FOR SELECT
  TO authenticated
  USING (student_id = public.current_student_id());

CREATE POLICY "applications_select_admin"
  ON public.placement_applications FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "applications_insert_student"
  ON public.placement_applications FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id = public.current_student_id() AND
    status = 'Applied'
  );

CREATE POLICY "applications_delete_student"
  ON public.placement_applications FOR DELETE
  TO authenticated
  USING (
    student_id = public.current_student_id() AND
    status = 'Applied'
  );

-- 15.4 ADMISSIONS REGISTER (STRICTLY PRIVATE TO ADMIN & SERVICE ROLE)
ALTER TABLE public.admissions_register ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sc_admissions_register_read" ON public.admissions_register;
DROP POLICY IF EXISTS "sc_admissions_register_write" ON public.admissions_register;
DROP POLICY IF EXISTS "sc_admissions_read" ON public.admissions_register;
DROP POLICY IF EXISTS "sc_admissions_write" ON public.admissions_register;
DROP POLICY IF EXISTS "Allow all" ON public.admissions_register;
DROP POLICY IF EXISTS "admissions_admin_all" ON public.admissions_register;

CREATE POLICY "admissions_admin_all"
  ON public.admissions_register FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ==============================================================================
-- SECTION 16: RECONCILED MINIMAL SQL PRIVILEGES & STRICT COLUMN-SCOPED GRANTS
-- ==============================================================================

-- 16.1 BASELINE: Revoke all default table privileges from authenticated, anon, public
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated, anon, public;

-- Explicitly ensure NO table-wide UPDATE grants linger on sensitive operational tables
REVOKE UPDATE ON public.attendance FROM authenticated, anon, public;
REVOKE UPDATE ON public.marks FROM authenticated, anon, public;
REVOKE UPDATE ON public.announcements FROM authenticated, anon, public;
REVOKE UPDATE ON public.assignments FROM authenticated, anon, public;
REVOKE UPDATE ON public.resources FROM authenticated, anon, public;
REVOKE UPDATE ON public.lost_found FROM authenticated, anon, public;

-- 16.2 READ-ONLY GRANTS ACROSS CATALOG & GENERAL QUERIED TABLES
GRANT SELECT ON public.departments TO authenticated;
GRANT SELECT ON public.courses TO authenticated;
GRANT SELECT ON public.subjects TO authenticated;
GRANT SELECT ON public.classes TO authenticated;
GRANT SELECT ON public.exams TO authenticated;
GRANT SELECT ON public.fees TO authenticated;
GRANT SELECT ON public.students TO authenticated;
GRANT SELECT ON public.faculty TO authenticated;
GRANT SELECT ON public.timetable TO authenticated;
GRANT SELECT ON public.enrollments TO authenticated;
GRANT SELECT ON public.events TO authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT SELECT ON public.resources TO authenticated;
GRANT SELECT ON public.lost_found TO authenticated;
GRANT SELECT ON public.placements TO authenticated;
GRANT SELECT ON public.placement_applications TO authenticated;

-- NOTE: public.admissions_register is intentionally NOT granted to authenticated.
-- It remains 100% private to administrators and service-role backend provisioning routines.

-- 16.3 PROFILES: SELECT and Column-Scoped UPDATE (Non-Privileged Profile Fields Only)
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (avatar_url, phone, updated_at) ON public.profiles TO authenticated;

-- 16.4 SUPPORT TICKETS: SELECT, INSERT, Column-Scoped UPDATE
GRANT SELECT, INSERT ON public.support_tickets TO authenticated;
GRANT UPDATE (subject, description, updated_at) ON public.support_tickets TO authenticated;

-- 16.5 EVENT REGISTRATIONS: SELECT, INSERT, DELETE (Self Registrations Only)
GRANT SELECT, INSERT, DELETE ON public.event_registrations TO authenticated;

-- 16.6 NOTIFICATIONS: SELECT and Column-Scoped UPDATE on Read Status
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read) ON public.notifications TO authenticated;

-- 16.7 ASSIGNMENT SUBMISSIONS: SELECT, INSERT, and Column-Scoped UPDATE
GRANT SELECT, INSERT ON public.assignment_submissions TO authenticated;
GRANT UPDATE (submission_url, file_url, status, marks_obtained, feedback) ON public.assignment_submissions TO authenticated;

-- 16.8 ATTENDANCE: SELECT, INSERT, and Column-Scoped UPDATE ONLY (No Table-Wide UPDATE)
-- Ordinary faculty cannot alter student_id, class_id, subject_id, faculty_id, date, or id
GRANT SELECT, INSERT ON public.attendance TO authenticated;
GRANT UPDATE (status, remarks) ON public.attendance TO authenticated;

-- 16.9 MARKS: SELECT, INSERT, and Column-Scoped UPDATE ONLY (No Table-Wide UPDATE)
-- Ordinary faculty cannot alter student_id, exam_id, subject_id, entered_by, or id
GRANT SELECT, INSERT ON public.marks TO authenticated;
GRANT UPDATE (marks_obtained, grade, remarks, updated_at) ON public.marks TO authenticated;

-- 16.10 ASSIGNMENTS: SELECT, INSERT, Column-Scoped UPDATE, and DELETE
-- Prevents faculty from altering class_id or faculty_id ownership on existing assignments
-- Verified actual columns: id, title, description, class_id, subject_id, faculty_id, due_date, max_marks, attachment_url, created_at
GRANT SELECT, INSERT, DELETE ON public.assignments TO authenticated;
GRANT UPDATE (title, description, due_date, max_marks, attachment_url) ON public.assignments TO authenticated;

-- 16.11 ANNOUNCEMENTS: SELECT, INSERT, and Column-Scoped UPDATE ONLY
-- Prevents faculty from altering author_id or department_id
GRANT SELECT, INSERT ON public.announcements TO authenticated;
GRANT UPDATE (title, content, category, target_audience, published, publish_date, expiry_date) ON public.announcements TO authenticated;

-- 16.12 RESOURCES: SELECT, INSERT, Column-Scoped UPDATE, DELETE
-- Verified actual columns: id, title, subject_id, file_url, file_type, uploaded_by, created_at
-- Uploaded_by and id are immutable identity columns
GRANT INSERT, DELETE ON public.resources TO authenticated;
GRANT UPDATE (title, subject_id, file_url, file_type) ON public.resources TO authenticated;

-- 16.13 LOST & FOUND: SELECT, INSERT, Column-Scoped UPDATE, DELETE
GRANT INSERT, DELETE ON public.lost_found TO authenticated;
GRANT UPDATE (title, description, location, image_url, status) ON public.lost_found TO authenticated;

-- 16.14 PLACEMENT APPLICATIONS: SELECT, INSERT, DELETE (For Student Application Lifecycle)
GRANT INSERT, DELETE ON public.placement_applications TO authenticated;

-- 16.15 ROUTINE PRIVILEGES HARDENING & EXPLICIT RE-GRANTS
-- Revoke all default routine execution privileges from public, anon, and authenticated
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM authenticated, anon, public;

-- Explicitly re-grant EXECUTE strictly on verified active helper functions to authenticated
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_faculty() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_student_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_faculty_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_audit_json(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_faculty_class_roster(UUID) TO authenticated;

-- NOTE: The demo database does NOT contain time_to_minutes, timetable_slot_range,
-- or verify_student_admission_eligibility. Unsupported grants for these have been removed.

-- Guarded re-grants for optional schema functions (only executed if verified present in database)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'claim_student_admission') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.claim_student_admission(TEXT, TEXT) TO authenticated;';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_own_profile') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_own_profile(TEXT, TEXT) TO authenticated;';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mark_notification_read') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID) TO authenticated;';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'initialize_payment') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.initialize_payment(UUID, NUMERIC, TEXT) TO authenticated;';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_manual_offline_payment') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.record_manual_offline_payment(UUID, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_upsert_profile') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_upsert_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;';
  END IF;
END $$;

-- Strictly restrict backend financial settlement routines to service_role
GRANT EXECUTE ON FUNCTION public.settle_online_payment_atomic(TEXT, NUMERIC, UUID, UUID, TEXT, TEXT) TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'complete_online_payment_verified') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.complete_online_payment_verified(UUID, TEXT, BOOLEAN) TO service_role;';
  END IF;
END $$;

-- ==============================================================================
-- SECTION 17: NON-DESTRUCTIVE ROLLBACK PROCEDURE
-- ==============================================================================
-- In the event that write-access policies must be rolled back to read-only status:
-- See executable migration: supabase/migrations/20261019000001_scholarcore_rollback_to_readonly.sql
--
-- 1. PostgreSQL Engine Truth:
--    In PostgreSQL RLS, policies default to AS PERMISSIVE. Permissive policies combine
--    via Boolean OR. Therefore, adding a permissive policy with `WITH CHECK (false)`
--    does NOT override or block an existing permissive policy (`true OR false = true`).
--    To reliably disable write access:
--      a) Explicitly REVOKE table-wide and column-scoped INSERT, UPDATE, DELETE grants.
--      b) Explicitly DROP all write-capable policies installed by this migration.
--      c) Keep ROW LEVEL SECURITY continuously ENABLED across all tables.
--      d) Retain/restore safe SELECT grants and policies for 100% read uptime.
--
-- 2. Complete Executable Rollback Script:
--
--    -- STEP A: Revoke all table-level and column-level write, truncate, references, and trigger grants
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated, anon, PUBLIC;
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM authenticated, anon, PUBLIC;
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.attendance FROM authenticated, anon, PUBLIC;
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.marks FROM authenticated, anon, PUBLIC;
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.assignments FROM authenticated, anon, PUBLIC;
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.assignment_submissions FROM authenticated, anon, PUBLIC;
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.announcements FROM authenticated, anon, PUBLIC;
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.notifications FROM authenticated, anon, PUBLIC;
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.support_tickets FROM authenticated, anon, PUBLIC;
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.event_registrations FROM authenticated, anon, PUBLIC;
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.resources FROM authenticated, anon, PUBLIC;
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.lost_found FROM authenticated, anon, PUBLIC;
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.placement_applications FROM authenticated, anon, PUBLIC;
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.payments FROM authenticated, anon, PUBLIC;
--    REVOKE ALL ON public.audit_logs FROM authenticated, anon, PUBLIC;
--    REVOKE ALL ON public.admissions_register FROM authenticated, anon, PUBLIC;
--
--    -- STEP B: Drop all write-capable RLS policies
--    DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
--    DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
--    DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;
--    DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
--    DROP POLICY IF EXISTS "attendance_insert_faculty" ON public.attendance;
--    DROP POLICY IF EXISTS "attendance_update_faculty" ON public.attendance;
--    DROP POLICY IF EXISTS "attendance_admin_all" ON public.attendance;
--    DROP POLICY IF EXISTS "marks_insert_faculty" ON public.marks;
--    DROP POLICY IF EXISTS "marks_update_faculty" ON public.marks;
--    DROP POLICY IF EXISTS "marks_admin_all" ON public.marks;
--    DROP POLICY IF EXISTS "submissions_insert_student" ON public.assignment_submissions;
--    DROP POLICY IF EXISTS "submissions_update_student" ON public.assignment_submissions;
--    DROP POLICY IF EXISTS "submissions_update_faculty" ON public.assignment_submissions;
--    DROP POLICY IF EXISTS "submissions_grade_faculty" ON public.assignment_submissions;
--    DROP POLICY IF EXISTS "submissions_admin_all" ON public.assignment_submissions;
--    DROP POLICY IF EXISTS "assignments_insert_faculty" ON public.assignments;
--    DROP POLICY IF EXISTS "assignments_update_faculty" ON public.assignments;
--    DROP POLICY IF EXISTS "assignments_delete_faculty" ON public.assignments;
--    DROP POLICY IF EXISTS "assignments_admin_all" ON public.assignments;
--    DROP POLICY IF EXISTS "announcements_insert_faculty" ON public.announcements;
--    DROP POLICY IF EXISTS "announcements_update_faculty" ON public.announcements;
--    DROP POLICY IF EXISTS "announcements_delete_admin" ON public.announcements;
--    DROP POLICY IF EXISTS "tickets_insert_own" ON public.support_tickets;
--    DROP POLICY IF EXISTS "tickets_update_own" ON public.support_tickets;
--    DROP POLICY IF EXISTS "tickets_update_admin" ON public.support_tickets;
--    DROP POLICY IF EXISTS "registrations_insert_own" ON public.event_registrations;
--    DROP POLICY IF EXISTS "registrations_delete_own" ON public.event_registrations;
--    DROP POLICY IF EXISTS "notifications_update_read_own" ON public.notifications;
--    DROP POLICY IF EXISTS "resources_insert_faculty" ON public.resources;
--    DROP POLICY IF EXISTS "resources_update_faculty" ON public.resources;
--    DROP POLICY IF EXISTS "resources_delete_faculty" ON public.resources;
--    DROP POLICY IF EXISTS "lost_found_insert_authenticated" ON public.lost_found;
--    DROP POLICY IF EXISTS "lost_found_update_reporter" ON public.lost_found;
--    DROP POLICY IF EXISTS "lost_found_delete_reporter" ON public.lost_found;
--    DROP POLICY IF EXISTS "applications_insert_student" ON public.placement_applications;
--    DROP POLICY IF EXISTS "applications_delete_student" ON public.placement_applications;
--
--    -- STEP C: PRESERVE Payment Immutability & Database Integrity Triggers
--    -- Payment immutability triggers (tr_protect_payment_tamper, tr_protect_payment_insert,
--    -- tr_protect_payment_delete), anti-tamper triggers, and sanitized audit triggers
--    -- are intentionally PRESERVED and NOT removed during rollback. They guarantee
--    -- financial immutability and audit trail integrity even during read-only operation.
--
--    -- STEP D: Ensure RLS remains continuously enabled on all 27 tables
--    -- (e.g. ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;)
--
--    -- STEP E: Restore & verify SELECT grants for continuous read uptime
--    GRANT SELECT ON public.departments TO authenticated;
--    GRANT SELECT ON public.courses TO authenticated;
--    GRANT SELECT ON public.subjects TO authenticated;
--    GRANT SELECT ON public.classes TO authenticated;
--    GRANT SELECT ON public.students TO authenticated;
--    GRANT SELECT ON public.faculty TO authenticated;
--    GRANT SELECT ON public.timetable TO authenticated;
--    GRANT SELECT ON public.enrollments TO authenticated;
--    GRANT SELECT ON public.attendance TO authenticated;
--    GRANT SELECT ON public.assignments TO authenticated;
--    GRANT SELECT ON public.assignment_submissions TO authenticated;
--    GRANT SELECT ON public.exams TO authenticated;
--    GRANT SELECT ON public.marks TO authenticated;
--    GRANT SELECT ON public.fees TO authenticated;
--    GRANT SELECT ON public.payments TO authenticated;
--    GRANT SELECT ON public.announcements TO authenticated;
--    GRANT SELECT ON public.notifications TO authenticated;
--    GRANT SELECT ON public.resources TO authenticated;
--    GRANT SELECT ON public.lost_found TO authenticated;
--    GRANT SELECT ON public.support_tickets TO authenticated;
--    GRANT SELECT ON public.events TO authenticated;
--    GRANT SELECT ON public.event_registrations TO authenticated;
--    GRANT SELECT ON public.placements TO authenticated;
--    GRANT SELECT ON public.placement_applications TO authenticated;
--    -- STEP F: Revoke sequence privileges from authenticated, anon, public
--    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated, anon, public;
--
--    -- STEP G: Revoke execution on mutating RPCs from client roles
--    REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM authenticated, anon, public;
--    GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
--    GRANT EXECUTE ON FUNCTION public.is_faculty() TO authenticated;
--    GRANT EXECUTE ON FUNCTION public.current_student_id() TO authenticated;
--    GRANT EXECUTE ON FUNCTION public.current_faculty_id() TO authenticated;
--    GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
--    GRANT EXECUTE ON FUNCTION public.sanitize_audit_json(JSONB) TO authenticated;
--    GRANT EXECUTE ON FUNCTION public.get_faculty_class_roster(UUID) TO authenticated;
--    GRANT EXECUTE ON FUNCTION public.settle_online_payment_atomic(TEXT, NUMERIC, UUID, UUID, TEXT, TEXT) TO service_role;
--
-- 3. Continuous Security Invariants:
--    - NEVER execute `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`.
--    - NEVER execute `DROP TABLE` or `TRUNCATE`.
--    - All SELECT policies remain active, ensuring 100% read uptime for all users.
-- ==============================================================================
