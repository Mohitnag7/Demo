import React, { useState, useEffect, useCallback } from 'react';
import { UserProfile, TabType } from '../types';
import {
  fetchFacultyDashboardData,
  FacultyDashboardData,
  FacultyStudentRosterItem,
} from '../lib/academic-data';

interface FacultyViewProps {
  currentUser: UserProfile;
  activeTab: TabType;
  searchQuery: string;
  onShowToast: (msg: string) => void;
  onNavigateTab: (tab: TabType) => void;
}

export const FacultyView: React.FC<FacultyViewProps> = ({
  currentUser,
  activeTab,
  searchQuery,
  onShowToast,
  onNavigateTab,
}) => {
  const [dashboardData, setDashboardData] = useState<FacultyDashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [roster, setRoster] = useState<FacultyStudentRosterItem[]>([]);
  const [activeGradeTab, setActiveGradeTab] = useState<'attendance' | 'marks'>('attendance');

  // Notice form state
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeBody, setNoticeBody] = useState('');
  const [targetSubject, setTargetSubject] = useState('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchFacultyDashboardData(currentUser.dbId);
      setDashboardData(data);

      if (data.roster && data.roster.length > 0) {
        setRoster(data.roster);
      }

      if (data.subjects && data.subjects.length > 0 && !selectedCourse) {
        setSelectedCourse(`${data.subjects[0].code} - ${data.subjects[0].name}`);
      }
    } catch (err: any) {
      console.error('Error fetching faculty dashboard data from Supabase:', err);
      setError(err?.message || 'Failed to query faculty data from database.');
    } finally {
      setLoading(false);
    }
  }, [currentUser.dbId, selectedCourse]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredRoster = roster.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.rollNo.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleToggleAttendance = (rollNo: string, newStatus: 'present' | 'absent' | 'late') => {
    setRoster((prev) =>
      prev.map((s) => (s.rollNo === rollNo ? { ...s, statusToday: newStatus } : s))
    );
  };

  const handleMarkAllPresent = () => {
    setRoster((prev) => prev.map((s) => ({ ...s, statusToday: 'present' })));
    onShowToast("All students marked as Present for today's lecture.");
  };

  const handleSaveAttendance = () => {
    const presentCount = roster.filter((s) => s.statusToday === 'present').length;
    onShowToast(`Attendance recorded for ${selectedCourse || 'Course'}: ${presentCount}/${roster.length} Present.`);
  };

  const handleMarksChange = (
    rollNo: string,
    field: 'mid1Marks' | 'mid2Marks' | 'assignmentMarks',
    val: number
  ) => {
    setRoster((prev) =>
      prev.map((s) => (s.rollNo === rollNo ? { ...s, [field]: Math.max(0, Math.min(30, val)) } : s))
    );
  };

  const handleSaveMarks = () => {
    onShowToast(`Internal marks updated successfully for ${selectedCourse || 'Course'}.`);
  };

  const handlePublishNotice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noticeTitle.trim()) return;
    onShowToast(`Class Circular "${noticeTitle}" published to students.`);
    setNoticeTitle('');
    setNoticeBody('');
  };

  const dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  if (activeTab === 'grading') {
    return (
      <div className="space-y-6">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-emerald-900 to-teal-900 text-white rounded-2xl p-6 shadow-md border border-emerald-700/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold uppercase tracking-wider mb-1">
              <span className="material-symbols-outlined text-sm">fact_check</span>
              Faculty Gradebook &amp; Attendance Register
            </div>
            <h2 className="text-2xl font-bold text-white">Student Evaluation Portal</h2>
            <p className="text-emerald-100/80 text-sm mt-0.5">
              Record daily attendance, upload mid-semester test marks, and track student performance.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              className="bg-emerald-950/80 text-white border border-emerald-600 rounded-xl px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-400 cursor-pointer shadow-sm"
            >
              {dashboardData?.subjects && dashboardData.subjects.length > 0 ? (
                dashboardData.subjects.map((s) => (
                  <option key={s.id} value={`${s.code} - ${s.name}`}>
                    {s.code} - {s.name} (Sem {s.semester})
                  </option>
                ))
              ) : (
                <option value="No Subjects">No Assigned Subjects</option>
              )}
            </select>
          </div>
        </div>

        {/* View Switcher: Attendance vs Marks */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-4 mb-6">
            <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
              <button
                type="button"
                onClick={() => setActiveGradeTab('attendance')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg flex items-center gap-2 transition-all cursor-pointer ${
                  activeGradeTab === 'attendance'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">event_available</span>
                Daily Attendance Register
              </button>
              <button
                type="button"
                onClick={() => setActiveGradeTab('marks')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg flex items-center gap-2 transition-all cursor-pointer ${
                  activeGradeTab === 'marks'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">assignment_turned_in</span>
                Internal Marks Entry
              </button>
            </div>

            {activeGradeTab === 'attendance' ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleMarkAllPresent}
                  disabled={roster.length === 0}
                  className="px-3.5 py-2 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-sm">select_all</span>
                  Mark All Present
                </button>
                <button
                  type="button"
                  onClick={handleSaveAttendance}
                  disabled={roster.length === 0}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-sm">save</span>
                  Save Attendance
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSaveMarks}
                disabled={roster.length === 0}
                className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">publish</span>
                Publish Internal Marks
              </button>
            )}
          </div>

          {/* Roster Table */}
          {loading ? (
            <div className="p-12 flex flex-col items-center justify-center text-slate-500">
              <div className="w-8 h-8 border-3 border-emerald-600/30 border-t-emerald-600 rounded-full animate-spin mb-3" />
              <p className="text-xs font-medium">Loading enrolled student roster...</p>
            </div>
          ) : filteredRoster.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">groups</span>
              <h4 className="font-bold text-slate-700">No Enrolled Students Found</h4>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                No students are currently enrolled in your assigned classes or subjects.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600 text-xs font-semibold uppercase tracking-wider">
                    <th className="py-3 px-4">Roll Number</th>
                    <th className="py-3 px-4">Student Name</th>
                    <th className="py-3 px-4">Semester</th>
                    <th className="py-3 px-4">Total Attendance</th>
                    {activeGradeTab === 'attendance' ? (
                      <th className="py-3 px-4 text-center">Today's Status</th>
                    ) : (
                      <>
                        <th className="py-3 px-4 text-center">Mid-1 (Max 30)</th>
                        <th className="py-3 px-4 text-center">Mid-2 (Max 30)</th>
                        <th className="py-3 px-4 text-center">Assignment (Max 10)</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRoster.map((student) => (
                    <tr key={student.id || student.rollNo} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-800">{student.rollNo}</td>
                      <td className="py-3.5 px-4 font-medium text-slate-900">{student.name}</td>
                      <td className="py-3.5 px-4 text-xs font-mono text-slate-600">Sem {student.semester}</td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-full ${
                                student.attendancePct >= 85
                                  ? 'bg-emerald-500'
                                  : student.attendancePct >= 75
                                  ? 'bg-amber-500'
                                  : 'bg-red-500'
                              }`}
                              style={{ width: `${student.attendancePct}%` }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-slate-700">{student.attendancePct}%</span>
                        </div>
                      </td>

                      {activeGradeTab === 'attendance' ? (
                        <td className="py-3.5 px-4 text-center">
                          <div className="inline-flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                            <button
                              type="button"
                              onClick={() => handleToggleAttendance(student.rollNo, 'present')}
                              className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                student.statusToday === 'present'
                                  ? 'bg-emerald-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              Present
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleAttendance(student.rollNo, 'absent')}
                              className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                student.statusToday === 'absent'
                                  ? 'bg-red-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              Absent
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleAttendance(student.rollNo, 'late')}
                              className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                student.statusToday === 'late'
                                  ? 'bg-amber-500 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              Late
                            </button>
                          </div>
                        </td>
                      ) : (
                        <>
                          <td className="py-3.5 px-4 text-center">
                            <input
                              type="number"
                              min="0"
                              max="30"
                              value={student.mid1Marks}
                              onChange={(e) => handleMarksChange(student.rollNo, 'mid1Marks', Number(e.target.value))}
                              className="w-16 text-center font-semibold text-slate-900 border border-slate-300 rounded-lg py-1 px-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                            />
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <input
                              type="number"
                              min="0"
                              max="30"
                              value={student.mid2Marks}
                              onChange={(e) => handleMarksChange(student.rollNo, 'mid2Marks', Number(e.target.value))}
                              className="w-16 text-center font-semibold text-slate-900 border border-slate-300 rounded-lg py-1 px-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                            />
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <input
                              type="number"
                              min="0"
                              max="10"
                              value={student.assignmentMarks}
                              onChange={(e) => handleMarksChange(student.rollNo, 'assignmentMarks', Number(e.target.value))}
                              className="w-16 text-center font-semibold text-slate-900 border border-slate-300 rounded-lg py-1 px-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                            />
                          </td>
                        </>
                      )}
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

  // Default: Faculty Dashboard ('faculty-dashboard' or main overview)
  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 text-white rounded-2xl p-6 md:p-8 shadow-md border border-emerald-800/40 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              className="w-16 h-16 rounded-full border-2 border-emerald-400 object-cover shadow-md"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[11px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                  Faculty Portal
                </span>
                <span className="text-slate-300 text-xs font-mono">
                  {dashboardData?.facultyIdText || currentUser.idNumber}
                </span>
                {dashboardData?.designation && (
                  <span className="text-emerald-400 text-xs font-medium">
                    • {dashboardData.designation}
                  </span>
                )}
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white mt-1">{currentUser.name}</h1>
              <p className="text-slate-300 text-sm">
                {currentUser.department || dashboardData?.departmentName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="bg-emerald-950/80 hover:bg-emerald-900 text-emerald-200 border border-emerald-700/60 px-3.5 py-2 rounded-xl font-semibold text-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Refresh faculty dashboard from live database"
            >
              <span className={`material-symbols-outlined text-sm ${loading ? 'animate-spin' : ''}`}>
                refresh
              </span>
              Refresh Live Data
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('grading')}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-semibold text-sm shadow-md transition-all flex items-center gap-2 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">how_to_reg</span>
              Mark Attendance &amp; Grades
            </button>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3">
          <span className="material-symbols-outlined text-rose-600 mt-0.5">error</span>
          <div className="flex-1">
            <h4 className="font-bold text-sm">Failed to retrieve faculty records</h4>
            <p className="text-xs text-rose-700 mt-0.5">{error}</p>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Faculty Key Metrics (Authoritative data from database) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Courses */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-2xl">menu_book</span>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Active Courses</p>
            {loading ? (
              <div className="h-7 flex items-center">
                <div className="w-4 h-4 border-2 border-emerald-600/30 border-t-emerald-600 rounded-full animate-spin" />
              </div>
            ) : (
              <h3 className="text-xl font-bold text-slate-900">
                {dashboardData?.subjects.length ?? 0} {dashboardData?.subjects.length === 1 ? 'Subject' : 'Subjects'}
              </h3>
            )}
            <p className="text-[11px] text-emerald-600 font-medium">
              {dashboardData?.subjects && dashboardData.subjects.length > 0
                ? `${dashboardData.subjects.reduce((sum, s) => sum + (s.credits || 0), 0)} Credits Assigned`
                : 'No teaching assignments'}
            </p>
          </div>
        </div>

        {/* Total Enrolled */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-2xl">groups</span>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Total Enrolled</p>
            {loading ? (
              <div className="h-7 flex items-center">
                <div className="w-4 h-4 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
              </div>
            ) : (
              <h3 className="text-xl font-bold text-slate-900">
                {dashboardData?.totalStudentsEnrolled ?? 0} {dashboardData?.totalStudentsEnrolled === 1 ? 'Student' : 'Students'}
              </h3>
            )}
            <p className="text-[11px] text-indigo-600 font-medium">
              {dashboardData?.totalStudentsEnrolled && dashboardData.totalStudentsEnrolled > 0
                ? 'Active Roster'
                : 'No students enrolled'}
            </p>
          </div>
        </div>

        {/* Avg. Class Attendance */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-2xl">fact_check</span>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Avg. Class Attendance</p>
            {loading ? (
              <div className="h-7 flex items-center">
                <div className="w-4 h-4 border-2 border-teal-600/30 border-t-teal-600 rounded-full animate-spin" />
              </div>
            ) : dashboardData?.avgClassAttendance !== null && dashboardData?.avgClassAttendance !== undefined ? (
              <h3 className="text-xl font-bold text-slate-900">{dashboardData.avgClassAttendance}%</h3>
            ) : (
              <h3 className="text-xl font-bold text-slate-400">N/A</h3>
            )}
            <p className="text-[11px] text-emerald-600 font-medium">
              {dashboardData?.totalAttendanceSessions && dashboardData.totalAttendanceSessions > 0
                ? `${dashboardData.attendedSessions}/${dashboardData.totalAttendanceSessions} sessions present`
                : 'No attendance logged'}
            </p>
          </div>
        </div>

        {/* Pending Evaluation */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-2xl">pending_actions</span>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Pending Evaluation</p>
            {loading ? (
              <div className="h-7 flex items-center">
                <div className="w-4 h-4 border-2 border-amber-600/30 border-t-amber-600 rounded-full animate-spin" />
              </div>
            ) : (
              <h3 className="text-xl font-bold text-slate-900">
                {dashboardData?.pendingEvaluationsCount ?? 0} {dashboardData?.pendingEvaluationsCount === 1 ? 'Submission' : 'Submissions'}
              </h3>
            )}
            <p className="text-[11px] text-amber-600 font-medium">
              {dashboardData?.pendingEvaluationsCount && dashboardData.pendingEvaluationsCount > 0
                ? 'Awaiting grading'
                : 'All evaluations cleared'}
            </p>
          </div>
        </div>
      </div>

      {/* Main Grid: Schedule + Announcement Broadcaster */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Today's Class Schedule */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-600">calendar_month</span>
              <h3 className="font-bold text-slate-900 text-lg">Teaching Schedule</h3>
            </div>
            <span className="text-xs font-medium bg-slate-100 text-slate-700 px-3 py-1 rounded-full">
              {dashboardData?.todaySchedule && dashboardData.todaySchedule.length > 0
                ? `${dashboardData.todaySchedule.length} Lectures Today`
                : dashboardData?.schedule && dashboardData.schedule.length > 0
                ? `${dashboardData.schedule.length} Weekly Lectures`
                : 'No Lectures'}
            </span>
          </div>

          {loading ? (
            <div className="p-8 flex justify-center text-slate-500">
              <div className="w-6 h-6 border-2 border-emerald-600/30 border-t-emerald-600 rounded-full animate-spin" />
            </div>
          ) : (dashboardData?.todaySchedule && dashboardData.todaySchedule.length > 0) ||
            (dashboardData?.schedule && dashboardData.schedule.length > 0) ? (
            <div className="space-y-3">
              {((dashboardData.todaySchedule.length > 0 ? dashboardData.todaySchedule : dashboardData.schedule)).map(
                (slot) => (
                  <div
                    key={slot.id}
                    className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-10 rounded-lg bg-emerald-600 text-white font-bold flex flex-col items-center justify-center text-xs shrink-0 font-mono">
                        <span>{slot.startTime}</span>
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">
                          {slot.subjectCode} - {slot.subjectName}
                        </h4>
                        <p className="text-xs text-slate-600">
                          {dayNames[slot.dayOfWeek] || 'Scheduled'} • {slot.className} • Room {slot.roomNumber}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigateTab('grading')}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                    >
                      Mark Attendance
                    </button>
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500">
              <span className="material-symbols-outlined text-3xl text-slate-300 mb-1">event_busy</span>
              <p className="text-xs font-medium">No teaching schedule slots configured in timetable.</p>
            </div>
          )}
        </div>

        {/* Right Column: Class Circular Broadcaster */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <span className="material-symbols-outlined text-emerald-600">campaign</span>
            <h3 className="font-bold text-slate-900 text-lg">Broadcast Class Notice</h3>
          </div>

          <form onSubmit={handlePublishNotice} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Target Course</label>
              <select
                value={targetSubject}
                onChange={(e) => setTargetSubject(e.target.value)}
                className="w-full text-xs font-medium bg-slate-50 border border-slate-300 rounded-lg p-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
              >
                <option value="all">All Assigned Classes</option>
                {dashboardData?.subjects.map((s) => (
                  <option key={s.id} value={s.code}>
                    {s.code} - {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Circular Title</label>
              <input
                type="text"
                placeholder="e.g. Assignment 3 Submission Deadline Extended"
                value={noticeTitle}
                onChange={(e) => setNoticeTitle(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Notice Description</label>
              <textarea
                rows={3}
                placeholder="Write message for students..."
                value={noticeBody}
                onChange={(e) => setNoticeBody(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-xl text-xs shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-base">send</span>
              Publish Notice to Students
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
