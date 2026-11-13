import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FeeItem, StudentProfile } from '../types';
import { supabase } from '../lib/supabase';

export interface PaymentModalProps {
  isOpen: boolean;
  feeItem?: FeeItem;
  totalPending: number;
  availableFees?: FeeItem[];
  student?: StudentProfile;
  onClose: () => void;
  onSuccess: (amountPaid: number, feeTitle: string, method: string, receiptNo?: string) => void;
}

type PaymentFlowState =
  | 'loading_config'
  | 'unconfigured'
  | 'idle'
  | 'creating_order'
  | 'checkout_active'
  | 'verifying_settlement'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'pending_timeout';

interface SettledReceiptDetails {
  receiptNo: string;
  amount: number;
  feeTitle: string;
  transactionRef: string;
  paidAt: string;
  method: string;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  feeItem,
  totalPending,
  availableFees = [],
  student,
  onClose,
  onSuccess,
}) => {
  const [method, setMethod] = useState<'UPI' | 'Card' | 'NetBanking'>('UPI');
  const [upiId, setUpiId] = useState('arjun@upi');
  const [paymentState, setPaymentState] = useState<PaymentFlowState>('loading_config');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Gateway configuration loaded from /api/payments/config
  const [gatewayConfig, setGatewayConfig] = useState<{
    configured: boolean;
    key_id: string | null;
    demo_enabled: boolean;
  } | null>(null);

  // Selected fee item to pay
  const [selectedFeeId, setSelectedFeeId] = useState<string>('');
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [settledReceipt, setSettledReceipt] = useState<SettledReceiptDetails | null>(null);
  const [pollAttempt, setPollAttempt] = useState<number>(0);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const activePaymentIdRef = useRef<string | null>(null);

  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Determine selectable fees
  const unpaidFees = availableFees.filter((f) => f.balance > 0);
  const currentFee = feeItem || unpaidFees.find((f) => f.id === selectedFeeId) || unpaidFees[0];

  const payAmount = currentFee ? currentFee.balance : totalPending;
  const payTitle = currentFee ? currentFee.title : 'Outstanding Semester Fee';

  // Fetch gateway configuration when modal opens
  useEffect(() => {
    if (!isOpen) {
      clearPolling();
      return;
    }

    let isMounted = true;
    setErrorMessage(null);
    setSettledReceipt(null);
    setPollAttempt(0);
    setPaymentState('loading_config');

    if (feeItem) {
      setSelectedFeeId(feeItem.id);
    } else if (unpaidFees.length > 0) {
      setSelectedFeeId(unpaidFees[0].id);
    }

    const checkConfig = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          if (isMounted) {
            setErrorMessage('Active user session required to initiate secure payment.');
            setPaymentState('failed');
          }
          return;
        }

        const res = await fetch('/api/payments/config', {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (!res.ok) {
          throw new Error(`Failed to query gateway status (HTTP ${res.status})`);
        }

        const config = await res.json();
        if (isMounted) {
          setGatewayConfig(config);

          if (!config.configured && !config.demo_enabled) {
            // Neither real Razorpay keys nor isolated demo payments are enabled
            setPaymentState('unconfigured');
          } else {
            // If real credentials are not set but demo is allowed, default to demo mode
            if (!config.configured && config.demo_enabled) {
              setIsDemoMode(true);
            } else {
              setIsDemoMode(false);
            }
            setPaymentState('idle');
          }
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('[Payment Gateway Config Error]:', err.message);
          setErrorMessage(err.message || 'Unable to contact payment verification server.');
          setPaymentState('failed');
        }
      }
    };

    checkConfig();

    return () => {
      isMounted = false;
      clearPolling();
    };
  }, [isOpen, feeItem, clearPolling]);

  // Load Razorpay Checkout SDK dynamically
  const loadRazorpayScript = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if ((window as any).Razorpay) {
        return resolve(true);
      }
      const existingScript = document.getElementById('razorpay-checkout-script');
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(true));
        existingScript.addEventListener('error', () => resolve(false));
        return;
      }
      const script = document.createElement('script');
      script.id = 'razorpay-checkout-script';
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  // Authoritative settlement polling loop
  const startPollingSettlement = useCallback(
    (paymentId: string, token: string, feeName: string, selectedMethod: string) => {
      clearPolling();
      activePaymentIdRef.current = paymentId;
      setPaymentState('verifying_settlement');
      let attempts = 0;
      const MAX_ATTEMPTS = 25; // 25 attempts * 2s = 50s max

      pollIntervalRef.current = setInterval(async () => {
        attempts++;
        setPollAttempt(attempts);

        try {
          const res = await fetch(`/api/payments/status/${paymentId}`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (!res.ok) {
            if (res.status === 404) {
              // Row not yet readable or pending replication
              return;
            }
            throw new Error(`Status check returned HTTP ${res.status}`);
          }

          const data = await res.json();
          const payment = data.payment;

          if (payment && payment.status === 'SUCCESS') {
            clearPolling();
            const receiptDetails: SettledReceiptDetails = {
              receiptNo: payment.receipt_no,
              amount: Number(payment.amount),
              feeTitle: feeName,
              transactionRef: payment.transaction_ref,
              paidAt: payment.paid_at || new Date().toISOString(),
              method: payment.payment_method || selectedMethod,
            };

            setSettledReceipt(receiptDetails);
            setPaymentState('success');
            onSuccess(
              receiptDetails.amount,
              receiptDetails.feeTitle,
              receiptDetails.method,
              receiptDetails.receiptNo
            );
          } else if (payment && payment.status === 'FAILED') {
            clearPolling();
            setErrorMessage('Payment settlement was marked FAILED by the institutional ledger.');
            setPaymentState('failed');
          } else if (attempts >= MAX_ATTEMPTS) {
            clearPolling();
            setPaymentState('pending_timeout');
          }
        } catch (err: any) {
          console.warn('[Polling Status Warning]:', err?.message);
          if (attempts >= MAX_ATTEMPTS) {
            clearPolling();
            setPaymentState('pending_timeout');
          }
        }
      }, 2000);
    },
    [clearPolling, onSuccess]
  );

  // Main payment submission handler
  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFee && !payAmount) {
      setErrorMessage('No fee record selected for payment.');
      return;
    }

    setErrorMessage(null);
    setPaymentState('creating_order');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setErrorMessage('Active user session expired. Please sign in again.');
        setPaymentState('failed');
        return;
      }

      const paymentMethodLabel =
        method === 'UPI' ? 'UPI' : method === 'Card' ? 'Credit Card' : 'Net Banking';

      // 1. Authoritative order creation on the server
      const targetFeeId = currentFee?.id || unpaidFees[0]?.id;
      if (!targetFeeId) {
        setErrorMessage('No valid fee ledger entry found to attach this transaction.');
        setPaymentState('failed');
        return;
      }

      const orderPayload = {
        fee_id: targetFeeId,
        amount: payAmount,
        payment_method: paymentMethodLabel,
        is_demo: isDemoMode,
        demo_mode: isDemoMode,
      };

      const orderRes = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(orderPayload),
      });

      const orderData = await orderRes.json();

      if (!orderRes.ok) {
        setErrorMessage(
          orderData.error || `Payment order creation failed (HTTP ${orderRes.status}).`
        );
        setPaymentState('failed');
        return;
      }

      const { order_id, payment_id, is_demo, key_id } = orderData;

      // 2. Route based on environment / mode
      if (is_demo) {
        // Isolated Demo Settlement Mode:
        // Trigger server-side atomic settlement RPC and poll for verified database state
        setPaymentState('verifying_settlement');

        const settleRes = await fetch('/api/payments/demo-settle', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            payment_id,
            transaction_ref: order_id,
          }),
        });

        if (!settleRes.ok) {
          const settleData = await settleRes.json();
          setErrorMessage(settleData.error || 'Failed to dispatch demo settlement RPC.');
          setPaymentState('failed');
          return;
        }

        // Start authoritative polling loop
        startPollingSettlement(payment_id, session.access_token, payTitle, paymentMethodLabel);
      } else {
        // Real Razorpay Gateway Mode:
        const scriptLoaded = await loadRazorpayScript();
        if (!scriptLoaded || !(window as any).Razorpay) {
          setErrorMessage('Unable to load Razorpay Checkout SDK. Check your internet connection.');
          setPaymentState('failed');
          return;
        }

        setPaymentState('checkout_active');

        const razorpayOptions = {
          key: key_id,
          amount: Math.round(payAmount * 100), // in paise
          currency: 'INR',
          name: 'ScholarCore College ERP',
          description: payTitle,
          order_id: order_id,
          handler: async function (_response: any) {
            // STRICT SAFETY RULE:
            // Do NOT mark payment successful from client callback alone!
            // Transition to verifying_settlement and poll database status until SUCCESS!
            setPaymentState('verifying_settlement');
            startPollingSettlement(
              payment_id,
              session.access_token,
              payTitle,
              paymentMethodLabel
            );
          },
          modal: {
            ondismiss: function () {
              setPaymentState('cancelled');
            },
          },
          prefill: {
            name: student?.name || '',
            email: student?.email || '',
            contact: student?.phone || '',
          },
          notes: {
            fee_id: targetFeeId,
            student_id: student?.dbId || '',
          },
          theme: {
            color: '#1E40AF',
          },
        };

        const rzp = new (window as any).Razorpay(razorpayOptions);
        rzp.on('payment.failed', function (resp: any) {
          console.error('[Razorpay Checkout Failure]:', resp.error);
          setErrorMessage(resp.error?.description || 'Payment authorization declined by gateway.');
          setPaymentState('failed');
        });

        rzp.open();
      }
    } catch (err: any) {
      console.error('[Payment Process Error]:', err);
      setErrorMessage(err?.message || 'An unexpected error occurred during payment processing.');
      setPaymentState('failed');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={() => {
          if (paymentState !== 'creating_order' && paymentState !== 'verifying_settlement') {
            onClose();
          }
        }}
      />

      <div className="relative bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 bg-[#171f33] text-white flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base">ScholarCore Payment Gateway</h3>
              {isDemoMode && (
                <span className="bg-amber-400 text-slate-900 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Demo Mode
                </span>
              )}
            </div>
            <p className="text-xs text-indigo-300">Authoritative Ledger Settlement Portal</p>
          </div>
          {paymentState !== 'creating_order' && paymentState !== 'verifying_settlement' && (
            <button
              onClick={onClose}
              className="text-gray-300 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          )}
        </div>

        {/* Unconfigured Gateway Advisory Screen */}
        {paymentState === 'unconfigured' && (
          <div className="p-6 space-y-5 text-sm text-center">
            <div className="w-14 h-14 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-center mx-auto text-amber-600">
              <span className="material-symbols-outlined text-3xl">warning</span>
            </div>
            <div>
              <h4 className="font-bold text-slate-800 text-base">Payment Gateway Offline</h4>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                Real online payment processing requires <code className="bg-slate-100 px-1 py-0.5 rounded text-indigo-700 font-mono">RAZORPAY_KEY_ID</code> and{' '}
                <code className="bg-slate-100 px-1 py-0.5 rounded text-indigo-700 font-mono">RAZORPAY_KEY_SECRET</code> server configuration.
              </p>
              <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl p-3 text-left text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-slate-700">Security Safeguards Enforced:</p>
                <p>• Simulated client-side settlements are blocked.</p>
                <p>• Fake Razorpay order generation is disabled.</p>
                <p>• Non-production testing requires <code className="font-mono text-indigo-700">ENABLE_DEMO_PAYMENTS=true</code>.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
            >
              Close Window
            </button>
          </div>
        )}

        {/* Loading Configuration */}
        {paymentState === 'loading_config' && (
          <div className="p-12 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-blue-600/20 border-t-[#1E40AF] rounded-full animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-600">Checking Payment Gateway Status...</p>
          </div>
        )}

        {/* Creating Order / Loading State */}
        {paymentState === 'creating_order' && (
          <div className="p-10 text-center space-y-4">
            <div className="w-10 h-10 border-3 border-blue-600/20 border-t-[#1E40AF] rounded-full animate-spin mx-auto" />
            <div>
              <h4 className="font-bold text-slate-800 text-sm">Authorizing Payment Order</h4>
              <p className="text-xs text-slate-500 mt-1">
                Verifying fee ledger balance and establishing cryptographic order with server...
              </p>
            </div>
          </div>
        )}

        {/* Checkout Active State */}
        {paymentState === 'checkout_active' && (
          <div className="p-10 text-center space-y-4">
            <div className="w-12 h-12 bg-blue-50 border border-blue-200 rounded-2xl flex items-center justify-center mx-auto text-[#1E40AF]">
              <span className="material-symbols-outlined text-3xl animate-pulse">lock_open</span>
            </div>
            <div>
              <h4 className="font-bold text-slate-800 text-base">Razorpay Checkout Active</h4>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed max-w-sm mx-auto">
                Please complete your authorization in the secure overlay.
                Do not refresh or close this browser window.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPaymentState('cancelled')}
              className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
            >
              Dismiss Checkout
            </button>
          </div>
        )}

        {/* Verifying Settlement Loop State */}
        {paymentState === 'verifying_settlement' && (
          <div className="p-10 text-center space-y-4">
            <div className="w-12 h-12 border-3 border-emerald-500/20 border-t-emerald-600 rounded-full animate-spin mx-auto" />
            <div>
              <h4 className="font-bold text-slate-800 text-base">Confirming Ledger Settlement</h4>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed max-w-sm mx-auto">
                Awaiting authoritative database confirmation from backend settlement RPC...
              </p>
              <div className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-[11px] font-mono mt-3">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                Status check {pollAttempt} of 25
              </div>
            </div>
          </div>
        )}

        {/* Confirmed Success State */}
        {paymentState === 'success' && settledReceipt && (
          <div className="p-6 space-y-5 text-sm">
            <div className="w-12 h-12 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-center mx-auto text-emerald-600">
              <span className="material-symbols-outlined text-3xl">check_circle</span>
            </div>
            <div className="text-center">
              <h4 className="font-bold text-slate-900 text-base">Payment Settled & Confirmed</h4>
              <p className="text-xs text-slate-500 mt-1">
                Your payment has been atomically recorded in the official college ledger.
              </p>
            </div>

            {/* Receipt Summary Card */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5 text-xs font-mono">
              <div className="flex justify-between items-center text-slate-600 border-b pb-2">
                <span>Receipt Number:</span>
                <span className="font-bold text-slate-900">{settledReceipt.receiptNo}</span>
              </div>
              <div className="flex justify-between items-center text-slate-600 border-b pb-2">
                <span>Fee Category:</span>
                <span className="font-bold text-slate-900 font-sans">{settledReceipt.feeTitle}</span>
              </div>
              <div className="flex justify-between items-center text-slate-600 border-b pb-2">
                <span>Amount Paid:</span>
                <span className="font-black text-[#1E40AF] text-sm font-sans">
                  ₹{settledReceipt.amount.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-600 border-b pb-2">
                <span>Method / Gateway:</span>
                <span className="font-semibold text-slate-800">{settledReceipt.method}</span>
              </div>
              <div className="flex justify-between items-center text-slate-600">
                <span>Database Status:</span>
                <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold text-[10px]">
                  SETTLED (SUCCESS)
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full bg-[#1E40AF] hover:bg-blue-800 text-white font-bold py-3 rounded-xl transition-all shadow-md text-xs cursor-pointer"
            >
              Done & Return to Fee Ledger
            </button>
          </div>
        )}

        {/* Failed / Error State */}
        {paymentState === 'failed' && (
          <div className="p-6 space-y-4 text-sm text-center">
            <div className="w-12 h-12 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-center mx-auto text-rose-600">
              <span className="material-symbols-outlined text-3xl">error</span>
            </div>
            <div>
              <h4 className="font-bold text-slate-900 text-base">Payment Initialization Failed</h4>
              <p className="text-xs text-rose-700 mt-2 bg-rose-50 border border-rose-200 p-3 rounded-xl text-left font-mono">
                {errorMessage || 'Payment could not be processed. Please check your network and balance.'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPaymentState('idle')}
                className="flex-1 bg-[#1E40AF] hover:bg-blue-800 text-white font-bold py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Cancelled State */}
        {paymentState === 'cancelled' && (
          <div className="p-6 space-y-4 text-sm text-center">
            <div className="w-12 h-12 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-center mx-auto text-amber-600">
              <span className="material-symbols-outlined text-3xl">cancel</span>
            </div>
            <div>
              <h4 className="font-bold text-slate-900 text-base">Payment Cancelled</h4>
              <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto">
                The checkout gateway overlay was closed before payment completion.
                No charges were deducted from your account.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPaymentState('idle')}
                className="flex-1 bg-[#1E40AF] hover:bg-blue-800 text-white font-bold py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
              >
                Reopen Payment
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Timeout / Pending Delayed State */}
        {paymentState === 'pending_timeout' && (
          <div className="p-6 space-y-4 text-sm text-center">
            <div className="w-12 h-12 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-center mx-auto text-amber-600">
              <span className="material-symbols-outlined text-3xl">hourglass_top</span>
            </div>
            <div>
              <h4 className="font-bold text-slate-900 text-base">Settlement In Progress</h4>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                Payment confirmation is taking longer than usual. Your transaction is recorded as{' '}
                <strong className="text-slate-800">PENDING</strong> in the college database.
                Once confirmed by the gateway webhook, your fee ledger will update automatically.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-[#1E40AF] hover:bg-blue-800 text-white font-bold py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
            >
              Done & Return to Dashboard
            </button>
          </div>
        )}

        {/* Standard Idle Payment Form */}
        {paymentState === 'idle' && (
          <form onSubmit={handlePay} className="p-6 space-y-5 text-sm">
            {/* Demo Mode Toggle (Only if demo is explicitly enabled on server) */}
            {gatewayConfig?.demo_enabled && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-600 text-base">bug_report</span>
                  <div>
                    <p className="text-xs font-bold text-amber-900">Isolated Demo Settlement Mode</p>
                    <p className="text-[11px] text-amber-700">
                      Executes atomic database settlement without external credit card processing
                    </p>
                  </div>
                </div>
                {gatewayConfig.configured && (
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isDemoMode}
                      onChange={(e) => setIsDemoMode(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600" />
                  </label>
                )}
              </div>
            )}

            {/* Fee Selection Dropdown if multiple unpaid fees exist and none was pre-selected */}
            {!feeItem && unpaidFees.length > 1 && (
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">
                  Select Outstanding Fee Category
                </label>
                <select
                  value={selectedFeeId}
                  onChange={(e) => setSelectedFeeId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-xs font-semibold focus:outline-none focus:border-[#1E40AF]"
                >
                  {unpaidFees.map((fee) => (
                    <option key={fee.id} value={fee.id}>
                      {fee.title} — Outstanding: ₹{fee.balance.toLocaleString('en-IN')}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Summary Box */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex justify-between items-center">
              <div>
                <p className="text-xs text-indigo-700 font-bold uppercase">{payTitle}</p>
                <p className="text-xs text-slate-600 font-mono mt-0.5">
                  Student ID: {student?.rollNo || 'Enrolled Student'}
                </p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-black text-[#1E40AF]">
                  ₹{payAmount.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {/* Payment Method Tabs */}
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wider">
                Select Payment Channel
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setMethod('UPI')}
                  className={`py-2 px-3 rounded-lg border text-xs font-bold flex flex-col items-center gap-1 transition-colors cursor-pointer ${
                    method === 'UPI'
                      ? 'border-[#1E40AF] bg-blue-50 text-[#1E40AF]'
                      : 'border-slate-200 text-slate-700 bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">qr_code_2</span>
                  UPI / PhonePe
                </button>

                <button
                  type="button"
                  onClick={() => setMethod('Card')}
                  className={`py-2 px-3 rounded-lg border text-xs font-bold flex flex-col items-center gap-1 transition-colors cursor-pointer ${
                    method === 'Card'
                      ? 'border-[#1E40AF] bg-blue-50 text-[#1E40AF]'
                      : 'border-slate-200 text-slate-700 bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">credit_card</span>
                  Debit/Credit Card
                </button>

                <button
                  type="button"
                  onClick={() => setMethod('NetBanking')}
                  className={`py-2 px-3 rounded-lg border text-xs font-bold flex flex-col items-center gap-1 transition-colors cursor-pointer ${
                    method === 'NetBanking'
                      ? 'border-[#1E40AF] bg-blue-50 text-[#1E40AF]'
                      : 'border-slate-200 text-slate-700 bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">account_balance</span>
                  Net Banking
                </button>
              </div>
            </div>

            {/* Method Details */}
            {method === 'UPI' && (
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Enter VPA / UPI ID
                </label>
                <input
                  type="text"
                  required
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="username@upi or mobile@paytm"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-2 text-slate-900 focus:outline-none focus:border-[#1E40AF]"
                />
              </div>
            )}

            {method === 'Card' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Card Number</label>
                  <input
                    type="text"
                    placeholder="4532 •••• •••• 8821"
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-2 text-slate-900"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="MM/YY"
                    className="bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-2 text-slate-900"
                  />
                  <input
                    type="password"
                    placeholder="CVV"
                    className="bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-2 text-slate-900"
                  />
                </div>
              </div>
            )}

            {method === 'NetBanking' && (
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Select Bank</label>
                <select className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-2 text-slate-900">
                  <option>State Bank of India (SBI)</option>
                  <option>HDFC Bank</option>
                  <option>ICICI Bank</option>
                  <option>Axis Bank</option>
                </select>
              </div>
            )}

            {/* Action Button */}
            <button
              type="submit"
              disabled={payAmount <= 0}
              className="w-full bg-[#1E40AF] hover:bg-blue-800 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">lock</span>
              Authorize Payment of ₹{payAmount.toLocaleString('en-IN')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
