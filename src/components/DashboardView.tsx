import React, { useState, useEffect, useCallback } from 'react';
import { StudentProfile, Notice, UpcomingEvent } from '../types';
import { fetchDashboardMetrics, DashboardMetricsData } from '../lib/academic-data';

interface DashboardViewProps {
  student: StudentProfile;
  notices: Notice[];
  events: UpcomingEvent[];
  onNavigateTab: (tab: 'academics' | 'fees' | 'resources' | 'lost-found') => void;
  onOpenAIPrompt: (prompt: string) => void;
  onSemesterChange?: (semester: number) => void;
  onRSVPEvent?: (eventId: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  student,
  notices,
  events,
  onNavigateTab,
  onOpenAIPrompt,
  onSemesterChange,
  onRSVPEvent,
}) => {
  const [metrics, setMetrics] = useState<DashboardMetricsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!student.dbId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchDashboardMetrics(
        student.dbId,
        student.cgpa,
        student.attendancePercent
      );
      setMetrics(data);
    } catch (err: any) {
      console.error('Error fetching dashboard metrics from database:', err);
      setError(err?.message || 'Failed to query student metrics.');
    } finally {
      setLoading(false);
    }
  }, [student.dbId, student.cgpa, student.attendancePercent]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Metric derivations
  const attendancePercent = metrics ? metrics.attendancePercent : null;
  const isAttendanceEligible = attendancePercent !== null && attendancePercent >= 75;

  const cgpaValue = metrics ? metrics.cgpa : null;

  const pendingDues = metrics !== null ? metrics.pendingDues : student.pendingDues;
  const isDuesCleared = pendingDues === 0;

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto pb-12">
      {/* Header Greeting & Info Chips */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
            Welcome back, {student.name.split(' ')[0]} 👋
          </h1>
          <div className="inline-flex flex-wrap items-center gap-2 bg-white border border-slate-200 shadow-2xs rounded-full px-3.5 py-1 mt-2 text-xs font-medium text-slate-600">
            <span>{student.department}</span>
            <span className="w-1 h-1 bg-slate-300 rounded-full" />
            <select
              className="bg-transparent border-none p-0 text-slate-600 font-medium text-xs focus:ring-0 cursor-pointer"
              value={student.semester}
              onChange={(e) => onSemesterChange?.(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => (
                <option key={sem} value={sem}>
                  Semester {sem}
                </option>
              ))}
            </select>
            <span className="w-1 h-1 bg-slate-300 rounded-full" />
            <span className="font-mono">Roll No: {student.rollNo}</span>
          </div>
        </div>

        {student.dbId && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadDashboard}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              title="Refresh dashboard metrics from database"
            >
              <span className={`material-symbols-outlined text-sm ${loading ? 'animate-spin' : ''}`}>
                refresh
              </span>
              Refresh Live Data
            </button>
          </div>
        )}
      </section>

      {/* Error Notice */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3">
          <span className="material-symbols-outlined text-rose-600 mt-0.5">error</span>
          <div className="flex-1">
            <h4 className="font-bold text-sm">Failed to retrieve some dashboard records</h4>
            <p className="text-xs text-rose-700 mt-0.5">{error}</p>
          </div>
          <button
            type="button"
            onClick={loadDashboard}
            className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Metric Grid (4 Cards) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Attendance Card */}
        <div
          onClick={() => onNavigateTab('academics')}
          className="bg-white border border-slate-200 shadow-2xs p-4 rounded-xl hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
        >
          <div>
            <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-1">
              Attendance
            </h3>
            {loading ? (
              <div className="h-8 flex items-center">
                <div className="w-5 h-5 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
              </div>
            ) : attendancePercent !== null ? (
              <div className="text-2xl font-black text-slate-900">{attendancePercent}%</div>
            ) : (
              <div className="text-2xl font-black text-slate-400">N/A</div>
            )}
            <p className="text-xs text-slate-500 mt-1">
              {metrics?.totalAttendanceSessions && metrics.totalAttendanceSessions > 0
                ? `Target: 75% (${metrics.attendedSessions}/${metrics.totalAttendanceSessions} attended)`
                : 'Target: 75%'}
            </p>
          </div>
          <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-slate-100"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className={isAttendanceEligible ? 'text-emerald-500' : 'text-amber-500'}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeDasharray={`${attendancePercent || 0}, 100`}
                strokeLinecap="round"
                strokeWidth="4"
              />
            </svg>
            <span
              className={`absolute material-symbols-outlined text-sm ${
                isAttendanceEligible ? 'text-emerald-600' : 'text-amber-600'
              }`}
            >
              {isAttendanceEligible ? 'trending_up' : 'warning'}
            </span>
          </div>
        </div>

        {/* CGPA Card */}
        <div
          onClick={() => onNavigateTab('academics')}
          className="bg-white border border-slate-200 shadow-2xs p-4 rounded-xl hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
        >
          <div className="flex justify-between items-start mb-1">
            <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider">CGPA</h3>
            <span className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-200">
              {metrics?.cgpaSource === 'calculated'
                ? 'Published Marks'
                : metrics?.cgpaSource === 'stored_registry'
                ? 'Registry Verified'
                : 'Pending'}
            </span>
          </div>
          {loading ? (
            <div className="h-8 flex items-center">
              <div className="w-5 h-5 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
            </div>
          ) : cgpaValue !== null ? (
            <>
              <div className="flex items-baseline gap-1.5 my-1">
                <span className="text-2xl font-black text-slate-900">{cgpaValue.toFixed(2)}</span>
                <span className="text-xs text-slate-500 font-medium">/ 10</span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
                <div
                  className="bg-indigo-600 h-full rounded-full"
                  style={{ width: `${Math.min(100, (cgpaValue / 10) * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <div className="my-1">
              <span className="text-xs font-bold text-slate-500">Not enough published results</span>
              <p className="text-[10px] text-slate-400 mt-0.5">Awaiting term examination marks</p>
            </div>
          )}
        </div>

        {/* Pending Fees Card */}
        <div
          onClick={() => onNavigateTab('fees')}
          className="bg-white border border-slate-200 shadow-2xs p-4 rounded-xl hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-1">
              Pending Fees
            </h3>
            {loading ? (
              <div className="h-8 flex items-center">
                <div className="w-5 h-5 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="text-2xl font-black text-slate-900">
                ₹{pendingDues.toLocaleString('en-IN')}
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            {isDuesCleared ? (
              <span className="flex items-center gap-1 text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full text-[11px]">
                <span className="material-symbols-outlined text-[13px]">check_circle</span> Cleared
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-700 font-semibold bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full text-[11px]">
                <span className="material-symbols-outlined text-[13px]">schedule</span> Payment Pending
              </span>
            )}
            <span className="text-indigo-600 font-medium hover:underline flex items-center gap-0.5">
              Fee Ledger <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
            </span>
          </div>
        </div>

        {/* Profile Card */}
        <div className="bg-white border border-slate-200 shadow-2xs p-4 rounded-xl flex items-center gap-3">
          <div className="w-14 h-14 rounded-full border-2 border-indigo-200 overflow-hidden shrink-0 shadow-2xs">
            <img src={student.avatar} alt={student.name} className="w-full h-full object-cover" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-slate-900 leading-tight">{student.name}</h4>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{student.rollNo}</p>
            <span className="inline-block mt-1 bg-slate-100 text-slate-700 text-[10px] font-medium px-2 py-0.5 rounded">
              Active Student
            </span>
          </div>
        </div>
      </section>

      {/* Main 2-Column Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (66%): Recent Notices */}
        <div className="lg:col-span-2 space-y-6">
          <section className="bg-white border border-slate-200 shadow-2xs rounded-xl p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-extrabold text-indigo-700 flex items-center gap-2">
                <span className="material-symbols-outlined text-indigo-600">notifications_active</span>
                Recent Notices
              </h2>
              <button
                type="button"
                onClick={() => onOpenAIPrompt('Summarize the latest exam and campus notices')}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 bg-indigo-50 px-2.5 py-1 rounded-md border border-indigo-200 cursor-pointer"
              >
                <span className="material-symbols-outlined text-xs">smart_toy</span> Summarize with AI
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {notices.map((notice) => (
                <div key={notice.id} className="py-3 hover:bg-slate-50 transition-colors rounded-lg p-2">
                  <div className="flex gap-3.5 items-start">
                    <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100 mt-0.5">
                      <span className="material-symbols-outlined text-[20px]">{notice.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <h4 className="font-semibold text-slate-900 text-sm leading-snug">
                          {notice.title}
                        </h4>
                        <span className="text-xs text-slate-500 shrink-0 font-mono">{notice.timeAgo}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded">
                          {notice.category}
                        </span>
                        <p className="text-xs text-slate-600 truncate">{notice.description}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Upcoming Events */}
          <section className="bg-white border border-slate-200 shadow-2xs rounded-xl p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-extrabold text-indigo-700 flex items-center gap-2">
                <span className="material-symbols-outlined text-indigo-600">event</span>
                Upcoming Campus Events
              </h2>
              <span className="text-xs text-slate-500 font-mono">Academic Year 2025-26</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {events.map((evt) => (
                <div
                  key={evt.id}
                  className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-indigo-200 transition-all flex flex-col justify-between"
                >
                  <div className="flex gap-3 items-start">
                    <div className="bg-white border border-slate-200 rounded-lg p-2 text-center shrink-0 shadow-2xs w-12">
                      <span className="block text-[10px] font-black text-indigo-600 uppercase">
                        {evt.dateMonth}
                      </span>
                      <span className="block text-base font-extrabold text-slate-900">{evt.dateDay}</span>
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{evt.title}</h4>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                        <span className="material-symbols-outlined text-xs">pin_drop</span>
                        {evt.location}
                      </p>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <span className="material-symbols-outlined text-xs">schedule</span>
                        {evt.time}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-[10px] font-medium text-slate-500">Registration Open</span>
                    <button
                      type="button"
                      onClick={() => onRSVPEvent?.(evt.id)}
                      disabled={evt.rsvpd}
                      className={`text-xs px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                        evt.rsvpd
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs active:scale-95'
                      }`}
                    >
                      {evt.rsvpd ? 'RSVP Confirmed' : 'RSVP Now'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Column (33%): Quick Actions & Advising */}
        <div className="space-y-6">
          {/* Quick Shortcuts */}
          <section className="bg-white border border-slate-200 shadow-2xs rounded-xl p-5">
            <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-indigo-600">bolt</span>
              Academic Navigation
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onNavigateTab('academics')}
                className="p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-left transition-all group cursor-pointer"
              >
                <span className="material-symbols-outlined text-indigo-600 text-xl block mb-1">school</span>
                <span className="text-xs font-bold text-slate-800 block">Exam Results</span>
                <span className="text-[10px] text-slate-500">Marks & Grades</span>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('fees')}
                className="p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-left transition-all group cursor-pointer"
              >
                <span className="material-symbols-outlined text-indigo-600 text-xl block mb-1">
                  account_balance_wallet
                </span>
                <span className="text-xs font-bold text-slate-800 block">Fee Payments</span>
                <span className="text-[10px] text-slate-500">Receipts & Dues</span>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('resources')}
                className="p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-left transition-all group cursor-pointer"
              >
                <span className="material-symbols-outlined text-indigo-600 text-xl block mb-1">menu_book</span>
                <span className="text-xs font-bold text-slate-800 block">Resources</span>
                <span className="text-[10px] text-slate-500">Syllabus & Notes</span>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('lost-found')}
                className="p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-left transition-all group cursor-pointer"
              >
                <span className="material-symbols-outlined text-indigo-600 text-xl block mb-1">search_check</span>
                <span className="text-xs font-bold text-slate-800 block">Lost & Found</span>
                <span className="text-[10px] text-slate-500">Campus Items</span>
              </button>
            </div>
          </section>

          {/* Academic Advising Banner */}
          <section className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-indigo-300 text-xs font-bold uppercase tracking-wider">
              <span className="material-symbols-outlined text-sm">psychology</span>
              Academic Intelligence
            </div>
            <h4 className="font-extrabold text-base leading-snug">
              Need assistance with assignments or exam preparations?
            </h4>
            <p className="text-xs text-indigo-100/80 leading-relaxed">
              ScholarCore AI Advisor can review syllabus modules, summarize lecture notes, and answer academic queries.
            </p>
            <button
              type="button"
              onClick={() => onOpenAIPrompt('How can I improve my academic performance and prepare for midterms?')}
              className="w-full bg-white hover:bg-slate-100 text-indigo-950 font-bold text-xs py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">smart_toy</span>
              Ask AI Academic Advisor
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};
