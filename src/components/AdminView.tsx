import React, { useState, useEffect, useCallback } from 'react';
import { UserProfile, TabType } from '../types';
import { fetchAdminDashboardData, AdminDashboardData } from '../lib/academic-data';

interface AdminViewProps {
  currentUser: UserProfile;
  activeTab: TabType;
  searchQuery: string;
  onShowToast: (msg: string) => void;
  onNavigateTab: (tab: TabType) => void;
}

interface StudentAdminRecord {
  id?: string;
  rollNo: string;
  name: string;
  branch: string;
  semester: number;
  cgpa: number;
  attendancePct: number;
  pendingFee: number;
  status: 'Active' | 'On Leave' | 'Graduated';
}

export const AdminView: React.FC<AdminViewProps> = ({
  currentUser,
  activeTab,
  searchQuery,
  onShowToast,
  onNavigateTab,
}) => {
  const [dashboardData, setDashboardData] = useState<AdminDashboardData | null>(null);
  const [studentsList, setStudentsList] = useState<StudentAdminRecord[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('All');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Notice broadcast form state
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeCategory, setNoticeCategory] = useState('Academic');
  const [noticeTarget, setNoticeTarget] = useState('All');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchAdminDashboardData();
      if (!data.authVerified) {
        setError(data.errorMessage || 'Access denied: Authoritative database check failed.');
      } else {
        setDashboardData(data);
        setStudentsList(data.studentsRoster);
      }
    } catch (err: any) {
      console.error('Error loading Admin dashboard metrics:', err);
      setError(err?.message || 'Failed to load administrative metrics from database.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Dynamic departments for branch filtering
  const availableBranches = dashboardData?.departments && dashboardData.departments.length > 0
    ? dashboardData.departments.map((d) => d.name)
    : Array.from(new Set(studentsList.map((s) => s.branch))).filter(Boolean);

  const filteredStudents = studentsList.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.rollNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.branch.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesBranch = selectedBranch === 'All' || s.branch === selectedBranch;
    return matchesSearch && matchesBranch;
  });

  const handlePromoteAllSemesters = () => {
    setStudentsList((prev) =>
      prev.map((s) => ({
        ...s,
        semester: Math.min(8, s.semester + 1),
      }))
    );
    onShowToast('Batch promotion applied: All active students promoted to next academic semester.');
  };

  const handleSendFeeReminder = (rollNo: string, name: string) => {
    onShowToast(`Fee collection reminder SMS & Email sent to ${name} (${rollNo}).`);
  };

  const handlePublishOfficialNotice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noticeTitle.trim()) return;
    onShowToast(`Institutional Circular "${noticeTitle}" published to ${noticeTarget}.`);
    setNoticeTitle('');
  };

  if (activeTab === 'student-mgmt') {
    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-950 text-white rounded-2xl p-6 shadow-md border border-purple-800/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-purple-300 text-xs font-semibold uppercase tracking-wider mb-1">
              <span className="material-symbols-outlined text-sm">badge</span>
              ERP Administrative Directory
            </div>
            <h2 className="text-2xl font-bold text-white">Student Information System (SIS)</h2>
            <p className="text-purple-100/80 text-sm mt-0.5">
              Manage student enrollment records, academic standings, and semester progressions.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="bg-purple-950/80 text-white border border-purple-600 rounded-xl px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer shadow-sm"
            >
              <option value="All">All Departments</option>
              {availableBranches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <button
              onClick={handlePromoteAllSemesters}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">publish</span>
              Batch Semester Roll-over
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-red-600">error</span>
              <span>{error}</span>
            </div>
            <button
              onClick={() => loadData()}
              className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Students Master Table */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
            <div className="text-xs text-slate-500">
              Showing <span className="font-bold text-slate-900">{filteredStudents.length}</span> verified students from database
            </div>
            <button
              onClick={() => loadData()}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              Refresh Directory
            </button>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              <span className="material-symbols-outlined animate-spin text-2xl text-purple-600 mb-2">progress_activity</span>
              <p>Loading student directory from database...</p>
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">school</span>
              <p className="font-medium text-slate-700">No student records match the selected filter or query.</p>
              <p className="text-xs text-slate-400 mt-1">Student records registered in public.students will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600 text-xs font-semibold uppercase tracking-wider">
                    <th className="py-3 px-4">Roll Number</th>
                    <th className="py-3 px-4">Student Name</th>
                    <th className="py-3 px-4">Department &amp; Branch</th>
                    <th className="py-3 px-4 text-center">Semester</th>
                    <th className="py-3 px-4 text-center">CGPA</th>
                    <th className="py-3 px-4 text-center">Attendance</th>
                    <th className="py-3 px-4 text-center">Fee Dues</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStudents.map((s) => (
                    <tr key={s.id || s.rollNo} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-900">{s.rollNo}</td>
                      <td className="py-3.5 px-4 font-medium text-slate-900">{s.name}</td>
                      <td className="py-3.5 px-4 text-slate-600 text-xs">{s.branch}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-indigo-700">Sem {s.semester}</td>
                      <td className="py-3.5 px-4 text-center font-semibold text-slate-800">
                        {s.cgpa > 0 ? s.cgpa.toFixed(1) : 'N/A'}
                      </td>
                      <td className="py-3.5 px-4 text-center font-medium text-slate-700">
                        {s.attendancePct > 0 ? `${s.attendancePct}%` : 'N/A'}
                      </td>
                      <td className="py-3.5 px-4 text-center font-semibold">
                        {s.pendingFee > 0 ? (
                          <span className="text-red-600 bg-red-50 border border-red-200 px-2.5 py-0.5 rounded-full text-xs">
                            ₹{s.pendingFee.toLocaleString('en-IN')}
                          </span>
                        ) : (
                          <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full text-xs">
                            Cleared
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {s.pendingFee > 0 && (
                          <button
                            onClick={() => handleSendFeeReminder(s.rollNo, s.name)}
                            className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                          >
                            Send Fee Notice
                          </button>
                        )}
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
  }

  if (activeTab === 'fee-audit') {
    const feeSummary = dashboardData?.feesSummary;
    const totalBilled = feeSummary?.totalBilled ?? 0;
    const settledPayments = feeSummary?.settledPayments ?? 0;
    const outstandingDues = feeSummary?.outstandingDues ?? 0;
    const realizationRate = feeSummary?.realizationRate;

    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 shadow-md border border-indigo-800/40">
          <div className="flex items-center gap-2 text-indigo-300 text-xs font-semibold uppercase tracking-wider mb-1">
            <span className="material-symbols-outlined text-sm">account_balance</span>
            Financial Compliance &amp; Revenue Audit
          </div>
          <h2 className="text-2xl font-bold text-white">Institutional Fee Accounting Portal</h2>
          <p className="text-indigo-100/80 text-sm mt-0.5">
            Monitor real-time fee collection stats, approve scholarship waivers, and generate financial reports.
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-red-600">error</span>
              <span>{error}</span>
            </div>
            <button
              onClick={() => loadData()}
              className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500">Total Billed Fees (Expected)</p>
            {isLoading ? (
              <div className="h-8 w-32 bg-slate-100 animate-pulse rounded mt-1" />
            ) : (
              <h3 className="text-2xl font-extrabold text-slate-900 mt-1">
                ₹{totalBilled.toLocaleString('en-IN')}
              </h3>
            )}
            <p className="text-xs text-slate-500 mt-2">
              {feeSummary?.billedCount ?? 0} Invoiced Records in Database
            </p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500">Total Collected (Settled Payments)</p>
            {isLoading ? (
              <div className="h-8 w-32 bg-slate-100 animate-pulse rounded mt-1" />
            ) : (
              <h3 className="text-2xl font-extrabold text-emerald-600 mt-1">
                ₹{settledPayments.toLocaleString('en-IN')}
              </h3>
            )}
            <p className="text-xs text-emerald-700 font-semibold mt-2">
              {realizationRate !== null
                ? `${realizationRate}% Realization Rate (${feeSummary?.paymentsCount ?? 0} Settled)`
                : 'No settled payment records'}
            </p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500">Total Outstanding Dues</p>
            {isLoading ? (
              <div className="h-8 w-32 bg-slate-100 animate-pulse rounded mt-1" />
            ) : (
              <h3 className="text-2xl font-extrabold text-red-600 mt-1">
                ₹{outstandingDues.toLocaleString('en-IN')}
              </h3>
            )}
            <button
              onClick={() => onShowToast('Bulk fee payment reminder emails dispatched to students with pending dues.')}
              className="mt-2 text-xs font-semibold text-indigo-600 hover:underline cursor-pointer flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">mail</span> Send Bulk Reminder
            </button>
          </div>
        </div>

        {/* Live Fee Ledger Table */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Institutional Fee Invoices</h3>
              <p className="text-xs text-slate-500">Live ledger of student fee charges and payment balances from database</p>
            </div>
            <button
              onClick={() => loadData()}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              Refresh Ledger
            </button>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              <span className="material-symbols-outlined animate-spin text-2xl text-indigo-600 mb-2">progress_activity</span>
              <p>Loading fee ledger from Supabase...</p>
            </div>
          ) : !dashboardData?.feesList || dashboardData.feesList.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">receipt_long</span>
              <p className="font-medium text-slate-700">No fee records found in the development database.</p>
              <p className="text-xs text-slate-400 mt-1">Fee invoices created in public.fees will automatically appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
                    <th className="py-3 px-4">Fee Type</th>
                    <th className="py-3 px-4">Academic Year</th>
                    <th className="py-3 px-4 text-center">Semester</th>
                    <th className="py-3 px-4 text-right">Billed Amount</th>
                    <th className="py-3 px-4 text-right">Paid Amount</th>
                    <th className="py-3 px-4 text-right">Balance Due</th>
                    <th className="py-3 px-4 text-center">Due Date</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800 font-medium">
                  {dashboardData.feesList.map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 capitalize font-semibold text-slate-900">{f.feeType}</td>
                      <td className="py-3 px-4 font-mono">{f.academicYear}</td>
                      <td className="py-3 px-4 text-center">Sem {f.semester}</td>
                      <td className="py-3 px-4 text-right font-semibold">₹{f.amount.toLocaleString('en-IN')}</td>
                      <td className="py-3 px-4 text-right text-emerald-700">₹{f.paidAmount.toLocaleString('en-IN')}</td>
                      <td className="py-3 px-4 text-right font-bold text-red-600">₹{f.outstanding.toLocaleString('en-IN')}</td>
                      <td className="py-3 px-4 text-center text-slate-500">{f.dueDate || 'N/A'}</td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase ${
                            f.status === 'paid'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : f.status === 'partial'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-red-50 text-red-600 border border-red-200'
                          }`}
                        >
                          {f.status}
                        </span>
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
  }

  if (activeTab === 'exam-control') {
    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-slate-900 via-purple-950 to-slate-900 text-white rounded-2xl p-6 shadow-md border border-purple-800/40">
          <div className="flex items-center gap-2 text-purple-300 text-xs font-semibold uppercase tracking-wider mb-1">
            <span className="material-symbols-outlined text-sm">assignment</span>
            Examination Control &amp; Evaluation Cell
          </div>
          <h2 className="text-2xl font-bold text-white">Office of the Controller of Examinations</h2>
          <p className="text-purple-100/80 text-sm mt-0.5">
            Manage semester exam schedules, hall ticket generation approvals, and invigilation duties.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500">Enrolled Students</p>
            <h3 className="text-xl font-bold text-slate-900 mt-1">
              {dashboardData?.totalStudents ?? 0} Eligible
            </h3>
            <p className="text-xs text-purple-600 font-semibold mt-1">Verified via public.students</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500">Hall Tickets Status</p>
            <h3 className="text-xl font-bold text-emerald-600 mt-1">
              {dashboardData?.totalStudents ?? 0} Ready
            </h3>
            <p className="text-xs text-slate-500 mt-1">Authoritative Hall Clearance</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500">Assigned Invigilators</p>
            <h3 className="text-xl font-bold text-slate-900 mt-1">
              {dashboardData?.totalFaculty ?? 0} Faculty Members
            </h3>
            <p className="text-xs text-slate-500 mt-1">Active Faculty Roster</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Examination Timetable &amp; Schedule</h3>
              <p className="text-xs text-slate-500">Published official exam session dates and room assignments</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onShowToast('Digital Hall Tickets approved and released for eligible students.')}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">verified</span>
                Release Hall Tickets
              </button>
              <button
                onClick={() => onShowToast('Master Examination Timetable PDF exported successfully.')}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">download</span>
                Export Timetable
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Subject Code</th>
                  <th className="py-3 px-4">Course Name</th>
                  <th className="py-3 px-4">Exam Date</th>
                  <th className="py-3 px-4">Time Window</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800 font-medium">
                <tr className="hover:bg-slate-50/60">
                  <td className="py-3.5 px-4 font-mono font-bold text-purple-700">CS401</td>
                  <td className="py-3.5 px-4 font-semibold text-slate-900">Design &amp; Analysis of Algorithms</td>
                  <td className="py-3.5 px-4">Upcoming Session</td>
                  <td className="py-3.5 px-4">10:00 AM - 01:00 PM</td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full text-[11px] font-bold">
                      Scheduled
                    </span>
                  </td>
                </tr>
                <tr className="hover:bg-slate-50/60">
                  <td className="py-3.5 px-4 font-mono font-bold text-purple-700">CS402</td>
                  <td className="py-3.5 px-4 font-semibold text-slate-900">Database Management Systems</td>
                  <td className="py-3.5 px-4">Upcoming Session</td>
                  <td className="py-3.5 px-4">10:00 AM - 01:00 PM</td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full text-[11px] font-bold">
                      Scheduled
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Default: Admin Dashboard Control Center
  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-950 text-white rounded-2xl p-6 md:p-8 shadow-md border border-purple-800/40 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              className="w-16 h-16 rounded-full border-2 border-purple-400 object-cover shadow-md"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="bg-purple-500/30 text-purple-200 border border-purple-400/30 text-[11px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                  Admin Control Center
                </span>
                <span className="text-slate-300 text-xs font-mono">{currentUser.idNumber}</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white mt-1">
                {dashboardData?.adminProfile?.name || currentUser.name}
              </h1>
              <p className="text-slate-300 text-sm">
                {dashboardData?.adminProfile?.department || currentUser.department}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => loadData()}
              className="bg-slate-800/80 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl font-semibold text-sm border border-purple-500/30 flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">refresh</span>
              Refresh Metrics
            </button>
            <button
              onClick={() => onNavigateTab('student-mgmt')}
              className="bg-purple-600 hover:bg-purple-500 text-white px-5 py-2.5 rounded-xl font-semibold text-sm shadow-md transition-all flex items-center gap-2 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">group</span>
              Manage Student Directory
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-red-600">error</span>
            <span>{error}</span>
          </div>
          <button
            onClick={() => loadData()}
            className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Enrolled */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-2xl">school</span>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Total Enrolled</p>
            {isLoading ? (
              <div className="h-6 w-28 bg-slate-100 animate-pulse rounded mt-1" />
            ) : error ? (
              <h3 className="text-xl font-bold text-red-600">Unavailable</h3>
            ) : (
              <h3 className="text-xl font-bold text-slate-900">
                {dashboardData?.totalStudents ?? 0}{' '}
                {dashboardData?.totalStudents === 1 ? 'Student' : 'Students'}
              </h3>
            )}
            <p className="text-[11px] text-purple-600 font-medium">
              {isLoading
                ? 'Loading branches...'
                : dashboardData?.departmentCount && dashboardData.departmentCount > 0
                ? `${dashboardData.departmentCount} Department${dashboardData.departmentCount !== 1 ? 's' : ''}`
                : dashboardData?.courseCount && dashboardData.courseCount > 0
                ? `${dashboardData.courseCount} Course${dashboardData.courseCount !== 1 ? 's' : ''}`
                : 'No departments configured'}
            </p>
          </div>
        </div>

        {/* Card 2: Faculty & Staff */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-2xl">badge</span>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Faculty &amp; Staff</p>
            {isLoading ? (
              <div className="h-6 w-24 bg-slate-100 animate-pulse rounded mt-1" />
            ) : error ? (
              <h3 className="text-xl font-bold text-red-600">Unavailable</h3>
            ) : (
              <h3 className="text-xl font-bold text-slate-900">
                {dashboardData?.totalFaculty ?? 0}{' '}
                {dashboardData?.totalFaculty === 1 ? 'Member' : 'Members'}
              </h3>
            )}
            <p className="text-[11px] text-indigo-600 font-medium">
              {isLoading
                ? 'Loading faculty...'
                : (dashboardData?.totalFaculty ?? 0) > 0
                ? 'Full-time Faculty'
                : 'No faculty assigned'}
            </p>
          </div>
        </div>

        {/* Card 3: Fee Collection */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-2xl">account_balance_wallet</span>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Fee Collection</p>
            {isLoading ? (
              <div className="h-6 w-24 bg-slate-100 animate-pulse rounded mt-1" />
            ) : error ? (
              <h3 className="text-xl font-bold text-red-600">Unavailable</h3>
            ) : (
              <h3 className="text-xl font-bold text-slate-900">
                ₹{(dashboardData?.feesSummary.settledPayments ?? 0).toLocaleString('en-IN')}
              </h3>
            )}
            <p className="text-[11px] text-emerald-600 font-medium">
              {isLoading
                ? 'Calculating collection...'
                : dashboardData?.feesSummary.totalBilled && dashboardData.feesSummary.totalBilled > 0
                ? `${dashboardData.feesSummary.realizationRate ?? 0.0}% Realized (₹${dashboardData.feesSummary.totalBilled.toLocaleString('en-IN')} Billed)`
                : 'No fee records'}
            </p>
          </div>
        </div>

        {/* Card 4: Open Tickets */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-2xl">support_agent</span>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Open Tickets</p>
            {isLoading ? (
              <div className="h-6 w-24 bg-slate-100 animate-pulse rounded mt-1" />
            ) : error ? (
              <h3 className="text-xl font-bold text-red-600">Unavailable</h3>
            ) : (
              <h3 className="text-xl font-bold text-slate-900">
                {dashboardData?.openTicketsCount ?? 0} Support Case
                {(dashboardData?.openTicketsCount ?? 0) !== 1 ? 's' : ''}
              </h3>
            )}
            <p className="text-[11px] text-amber-600 font-medium">
              {isLoading
                ? 'Loading tickets...'
                : (dashboardData?.totalTicketsCount ?? 0) > 0
                ? `${dashboardData?.totalTicketsCount} Total Ticket${dashboardData?.totalTicketsCount !== 1 ? 's' : ''}`
                : 'No pending tickets'}
            </p>
          </div>
        </div>
      </div>

      {/* Main Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Audit Log Table */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-purple-600">history</span>
              <h3 className="font-bold text-slate-900 text-lg">System Audit &amp; Event Log</h3>
            </div>
            <button
              onClick={() => loadData()}
              className="text-xs font-mono text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">refresh</span> Live Telemetry
            </button>
          </div>

          {isLoading ? (
            <div className="py-8 text-center text-slate-400 text-sm">
              <span className="material-symbols-outlined animate-spin text-xl text-purple-600 mb-1">progress_activity</span>
              <p>Loading audit events from database...</p>
            </div>
          ) : !dashboardData?.recentAuditLogs || dashboardData.recentAuditLogs.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">
              <span className="material-symbols-outlined text-3xl text-slate-300 mb-1">policy</span>
              <p className="font-medium text-slate-700">No audit events recorded in database yet.</p>
              <p className="text-xs text-slate-400 mt-1">Actions performed on administrative tables are permanently logged.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dashboardData.recentAuditLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-purple-600 text-lg">
                      {log.action === 'INSERT'
                        ? 'add_circle'
                        : log.action === 'UPDATE'
                        ? 'edit'
                        : log.action === 'DELETE'
                        ? 'delete'
                        : 'history'}
                    </span>
                    <div>
                      <p className="text-xs font-semibold text-slate-900">{log.detail}</p>
                      <p className="text-[11px] text-slate-500 font-mono">
                        Table: public.{log.tableName}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">{log.timeAgo}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Official Circular Broadcaster */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <span className="material-symbols-outlined text-purple-600">campaign</span>
            <h3 className="font-bold text-slate-900 text-lg">Institutional Circular</h3>
          </div>

          <form onSubmit={handlePublishOfficialNotice} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Audience Group</label>
              <select
                value={noticeTarget}
                onChange={(e) => setNoticeTarget(e.target.value)}
                className="w-full text-xs font-medium bg-slate-50 border border-slate-300 rounded-lg p-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="All">All Campus (Students, Faculty &amp; Staff)</option>
                <option value="Students Only">Students Only</option>
                <option value="Faculty Only">Faculty Members Only</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Notice Headline</label>
              <input
                type="text"
                placeholder="e.g. End Semester Final Exam Timetable"
                value={noticeTitle}
                onChange={(e) => setNoticeTitle(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2.5 rounded-xl text-xs shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-base">send</span>
              Broadcast Institutional Notice
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

