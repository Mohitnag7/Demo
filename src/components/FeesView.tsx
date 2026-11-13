import React, { useState, useEffect, useCallback } from 'react';
import { StudentProfile, FeeItem, PaymentReceipt } from '../types';
import { fetchStudentFees, StudentFeesData } from '../lib/academic-data';

interface FeesViewProps {
  student: StudentProfile;
  fees?: FeeItem[];
  history?: PaymentReceipt[];
  onOpenPaymentModal: (fee?: FeeItem) => void;
  onDownloadReceipt: (receiptNo: string) => void;
  searchQuery: string;
  onSemesterChange?: (semester: number) => void;
  refreshTrigger?: number;
}

export const FeesView: React.FC<FeesViewProps> = ({
  student,
  fees: fallbackFees = [],
  history: fallbackHistory = [],
  onOpenPaymentModal,
  onDownloadReceipt,
  searchQuery,
  onSemesterChange,
  refreshTrigger = 0,
}) => {
  const [feesData, setFeesData] = useState<StudentFeesData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadFees = useCallback(async () => {
    if (!student.dbId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchStudentFees(student.dbId, student.semester);
      setFeesData(data);
    } catch (err: any) {
      console.error('Error fetching fee data from Supabase:', err);
      setError(err?.message || 'Failed to query student fees from database.');
    } finally {
      setLoading(false);
    }
  }, [student.dbId, student.semester]);

  useEffect(() => {
    loadFees();
  }, [loadFees, refreshTrigger]);

  const activeFees = feesData ? feesData.fees : fallbackFees;
  const activeHistory = feesData ? feesData.payments : fallbackHistory;

  const totalDuesRemaining = feesData ? feesData.totalDues : student.pendingDues;
  const totalPaidAmount = feesData ? feesData.totalPaid : student.paidAmount;

  const filteredHistory = activeHistory.filter(
    (item) =>
      item.feeType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.receiptNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.method.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto pb-12">
      {/* Student Info Chips */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2.5">
          <div className="bg-gray-50 border border-gray-200 rounded-full px-4 py-1.5 flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-[#1E40AF]">laptop_mac</span>
            <span className="text-xs text-[#1E40AF] font-bold">{student.department}</span>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-full px-4 py-1.5 flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-[#1E40AF]">calendar_today</span>
            <select
              className="bg-transparent border-none p-0 focus:ring-0 cursor-pointer text-xs text-[#1E40AF] font-bold"
              value={student.semester}
              onChange={(e) => onSemesterChange?.(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => (
                <option key={sem} value={sem}>
                  Semester {sem}
                </option>
              ))}
            </select>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-full px-4 py-1.5 flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-[#1E40AF]">badge</span>
            <span className="text-xs text-[#1E40AF] font-bold">Roll No: {student.rollNo}</span>
          </div>
        </div>

        {student.dbId && (
          <button
            type="button"
            onClick={loadFees}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-all active:scale-95 disabled:opacity-50"
            title="Refresh fee records"
          >
            <span className={`material-symbols-outlined text-sm ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            Refresh Fees
          </button>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3">
          <span className="material-symbols-outlined text-rose-600 mt-0.5">error</span>
          <div className="flex-1">
            <h4 className="font-bold text-sm">Failed to retrieve fee records</h4>
            <p className="text-xs text-rose-700 mt-0.5">{error}</p>
          </div>
          <button
            type="button"
            onClick={loadFees}
            className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Top 3 Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Dues Card */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#1E40AF] opacity-70 uppercase tracking-wider">
              TOTAL DUES REMAINING
            </span>
            <span className="material-symbols-outlined text-rose-500">
              {totalDuesRemaining > 0 ? 'warning' : 'check_circle'}
            </span>
          </div>
          <div>
            <span className="text-3xl md:text-4xl text-[#1E40AF] font-black">
              ₹{totalDuesRemaining.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex flex-wrap gap-3 items-center justify-between mt-auto pt-2">
            {totalDuesRemaining > 0 ? (
              <>
                <div className="bg-amber-50 text-amber-800 px-3 py-1 rounded-full text-xs font-bold border border-amber-200 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  Payment Pending
                </div>
                <button
                  type="button"
                  onClick={() => onOpenPaymentModal()}
                  className="bg-[#1E40AF] hover:bg-blue-800 text-white transition-colors text-xs font-bold px-4 py-2 rounded-lg shadow-sm active:scale-95"
                >
                  Pay All Now
                </button>
              </>
            ) : (
              <div className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold border border-emerald-200 flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">verified</span>
                All Dues Cleared
              </div>
            )}
          </div>
        </div>

        {/* Paid Card */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#1E40AF] opacity-70 uppercase tracking-wider">
              TOTAL SETTLED PAYMENTS
            </span>
            <span className="material-symbols-outlined text-emerald-600">check_circle</span>
          </div>
          <div>
            <span className="text-3xl md:text-4xl text-[#1E40AF] font-black">
              ₹{totalPaidAmount.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="mt-auto pt-2">
            <div className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold border border-emerald-200 flex items-center gap-1 w-max">
              <span className="material-symbols-outlined text-[14px]">verified</span>
              Verified Transactions
            </div>
          </div>
        </div>

        {/* Scholarship Card */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#1E40AF] opacity-70 uppercase tracking-wider">
              SCHOLARSHIP / WAIVER
            </span>
            <span className="material-symbols-outlined text-[#1E40AF]">workspace_premium</span>
          </div>
          <div>
            <span className="text-3xl md:text-4xl text-[#1E40AF] font-black">
              ₹{(student.scholarshipAmount || 0).toLocaleString('en-IN')}
            </span>
          </div>
          <div className="mt-auto pt-2">
            <span className="text-xs font-semibold text-[#1E40AF] flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
              {student.scholarshipAmount && student.scholarshipAmount > 0
                ? 'Institutional Waiver Applied'
                : 'Standard Tuition Structure'}
            </span>
          </div>
        </div>
      </div>

      {/* Fee Breakdown */}
      <div className="space-y-4 pt-2">
        <h3 className="text-xl font-bold text-[#1E40AF] flex items-center gap-2">
          <span className="material-symbols-outlined">account_tree</span>
          Semester {student.semester} Fee Breakdown
        </h3>

        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center text-slate-500 bg-white rounded-2xl border border-gray-200">
            <div className="w-8 h-8 border-3 border-blue-600/20 border-t-blue-600 rounded-full animate-spin mb-3" />
            <p className="text-xs font-medium">Querying fee records...</p>
          </div>
        ) : activeFees.length === 0 ? (
          <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-gray-200">
            <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">savings</span>
            <h4 className="font-bold text-slate-700">No Fee Records Found</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              No fee dues are currently scheduled for Semester {student.semester} in your student account.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {activeFees.map((fee) => (
              <div
                key={fee.id}
                className="bg-white border border-gray-200 rounded-2xl p-5 hover:border-blue-300 shadow-sm transition-all flex flex-col h-full"
              >
                <div className="flex justify-between items-start mb-4">
                  <h4 className="text-base text-[#1E40AF] font-bold flex-1">{fee.title}</h4>
                  <div
                    className={`px-2.5 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ml-2 ${
                      fee.status === 'FULLY PAID'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : fee.status === 'PARTIALLY PAID'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}
                  >
                    {fee.status}
                  </div>
                </div>

                <div className="space-y-3 mb-6 flex-1 text-sm">
                  <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                    <span className="text-[#1E40AF] opacity-70">Amount</span>
                    <span className="text-[#1E40AF] font-bold">₹{fee.amount.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                    <span className="text-[#1E40AF] opacity-70">Paid</span>
                    <span className="text-emerald-600 font-bold">₹{fee.paid.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#1E40AF] font-medium">Balance</span>
                    <span className="text-[#1E40AF] font-black">
                      ₹{fee.balance.toLocaleString('en-IN')}
                    </span>
                  </div>

                  <div className="w-full bg-gray-100 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        fee.balance === 0 ? 'bg-emerald-500' : 'bg-[#1E40AF]'
                      }`}
                      style={{ width: `${Math.min(100, fee.amount > 0 ? (fee.paid / fee.amount) * 100 : 100)}%` }}
                    />
                  </div>
                </div>

                {fee.balance > 0 ? (
                  <button
                    type="button"
                    onClick={() => onOpenPaymentModal(fee)}
                    className="w-full bg-transparent border border-[#1E40AF] text-[#1E40AF] hover:bg-blue-50 transition-colors text-sm py-2 px-4 rounded-lg font-bold active:scale-95 cursor-pointer"
                  >
                    Pay Balance (₹{fee.balance.toLocaleString('en-IN')})
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onDownloadReceipt(`REC-${fee.id}`)}
                    className="w-full bg-gray-50 border border-gray-200 text-[#1E40AF] hover:bg-gray-100 transition-colors text-sm py-2 px-4 rounded-lg font-semibold flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    Receipt
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payment History Table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm mt-8">
        <div className="p-5 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h3 className="text-lg font-bold text-[#1E40AF] flex items-center gap-2">
            <span className="material-symbols-outlined">history</span>
            Payment Ledger & History
          </h3>
          {filteredHistory.length > 0 && (
            <button
              type="button"
              onClick={() => onDownloadReceipt('FULL-STATEMENT')}
              className="bg-gray-50 border border-gray-200 text-[#1E40AF] hover:bg-gray-100 transition-colors text-xs font-bold py-2 px-4 rounded-lg flex items-center gap-2 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              Export Statement PDF
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-8 flex justify-center text-slate-500">
            <div className="w-6 h-6 border-2 border-blue-600/20 border-t-blue-600 rounded-full animate-spin" />
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">receipt_long</span>
            <h4 className="font-bold text-slate-700">No Payment Transactions Recorded</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Any completed fee payments and bank counter challans will be recorded here with official receipt references.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs text-[#1E40AF] font-bold uppercase tracking-wider">
                  <th className="p-4 pl-6">Receipt No</th>
                  <th className="p-4">Fee Type</th>
                  <th className="p-4">Date</th>
                  <th className="p-4">Method</th>
                  <th className="p-4 text-right">Amount</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 pr-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {filteredHistory.map((item) => (
                  <tr key={item.receiptNo} className="hover:bg-gray-50 transition-colors">
                    <td className="p-4 pl-6 font-bold text-[#1E40AF]">{item.receiptNo}</td>
                    <td className="p-4 text-[#1E40AF] font-semibold">{item.feeType}</td>
                    <td className="p-4 text-[#1E40AF] opacity-75">{item.date}</td>
                    <td className="p-4 text-[#1E40AF] opacity-75 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px]">payments</span>
                      {item.method}
                    </td>
                    <td className="p-4 text-[#1E40AF] text-right font-bold">
                      ₹{item.amount.toLocaleString('en-IN')}
                    </td>
                    <td className="p-4 text-center">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-extrabold border ${
                          item.status === 'SUCCESS'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : item.status === 'FAILED'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="p-4 pr-6 text-right">
                      <button
                        type="button"
                        onClick={() => onDownloadReceipt(item.receiptNo)}
                        aria-label="Download Receipt PDF"
                        className="text-[#1E40AF] p-1.5 rounded hover:bg-blue-50 transition-colors cursor-pointer"
                        title="Download PDF Receipt"
                      >
                        <span className="material-symbols-outlined text-[20px]">picture_as_pdf</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
