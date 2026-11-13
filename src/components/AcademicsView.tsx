import React, { useState, useEffect, useCallback } from 'react';
import { StudentProfile, SubjectResult } from '../types';
import { fetchAcademicResults, AcademicResultsData } from '../lib/academic-data';

interface AcademicsViewProps {
  student: StudentProfile;
  searchQuery: string;
  onSemesterChange?: (semester: number) => void;
  subTab?: 'internal' | 'external';
  onSubTabChange?: (tab: 'internal' | 'external') => void;
  // Kept for backward compatibility if passed
  internalResults?: SubjectResult[];
  externalResults?: SubjectResult[];
}

export const AcademicsView: React.FC<AcademicsViewProps> = ({ 
  student, 
  searchQuery, 
  onSemesterChange,
  subTab,
  onSubTabChange,
  internalResults: fallbackInternal = [],
  externalResults: fallbackExternal = []
}) => {
  const [internalResultType, setInternalResultType] = useState<'internal' | 'external'>(
    subTab || 'internal'
  );

  const activeResultType = subTab || internalResultType;

  const handleTabClick = (tab: 'internal' | 'external') => {
    setInternalResultType(tab);
    if (onSubTabChange) {
      onSubTabChange(tab);
    }
  };

  const [sortField, setSortField] = useState<'code' | 'name' | 'marks' | 'attendance'>('code');

  // Supabase query state
  const [academicData, setAcademicData] = useState<AcademicResultsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!student.dbId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchAcademicResults(student.dbId, student.semester);
      setAcademicData(data);
    } catch (err: any) {
      console.error('Error fetching academic records from Supabase:', err);
      setError(err?.message || 'Failed to retrieve academic results from the server.');
    } finally {
      setLoading(false);
    }
  }, [student.dbId, student.semester]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Determine current list from real database query if available, or fallback
  const internalList = academicData ? academicData.internalResults : fallbackInternal;
  const externalList = academicData ? academicData.externalResults : fallbackExternal;

  const currentList = activeResultType === 'internal' ? internalList : externalList;

  const filteredList = currentList.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedList = [...filteredList].sort((a, b) => {
    if (sortField === 'name') return a.name.localeCompare(b.name);
    if (sortField === 'marks') return b.internalMarks - a.internalMarks;
    if (sortField === 'attendance') return b.attendancePercent - a.attendancePercent;
    return a.code.localeCompare(b.code);
  });

  // Authoritative metrics derived only from real database data
  const displaySGPA = academicData?.calculatedSGPA !== null && academicData?.calculatedSGPA !== undefined
    ? `${academicData.calculatedSGPA} / 10`
    : 'N/A';

  const displayCGPA = student.cgpa && student.cgpa > 0
    ? student.cgpa.toFixed(2)
    : 'N/A';

  const attendanceValue = academicData?.overallAttendancePercent !== null && academicData?.overallAttendancePercent !== undefined
    ? academicData.overallAttendancePercent
    : student.attendancePercent > 0
    ? student.attendancePercent
    : null;

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto pb-12">
      {/* Top Header & Student Info Chips */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#4338ca] tracking-tight">
            Academic Results & Performance
          </h1>
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-indigo-50 text-[#4338ca] font-mono text-xs font-semibold border border-indigo-200">
              <span className="material-symbols-outlined text-[15px]">badge</span>
              Roll No: {student.rollNo}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-indigo-50 text-[#4338ca] text-xs font-semibold border border-indigo-200">
              <span className="material-symbols-outlined text-[15px]">computer</span>
              {student.department}
            </span>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-semibold border border-blue-200">
              <span className="material-symbols-outlined text-[15px]">calendar_month</span>
              <select
                className="bg-transparent border-none p-0 focus:ring-0 cursor-pointer font-semibold text-blue-700"
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
          </div>
        </div>

        {/* Refresh / Status indicator */}
        {student.dbId && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-all active:scale-95 disabled:opacity-50"
              title="Refresh results from database"
            >
              <span className={`material-symbols-outlined text-sm ${loading ? 'animate-spin' : ''}`}>
                refresh
              </span>
              Refresh Records
            </button>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3">
          <span className="material-symbols-outlined text-rose-600 mt-0.5">error</span>
          <div className="flex-1">
            <h4 className="font-bold text-sm">Failed to query academic tables</h4>
            <p className="text-xs text-rose-700 mt-0.5">{error}</p>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Results Tab Switcher */}
      <div className="border-b border-slate-200 flex justify-between items-center">
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => handleTabClick('internal')}
            className={`px-4 py-2.5 font-bold text-sm transition-colors border-b-2 cursor-pointer ${
              activeResultType === 'internal'
                ? 'text-[#4338ca] border-[#4338ca]'
                : 'text-slate-500 border-transparent hover:text-slate-800'
            }`}
          >
            Internal Results (Mid-Terms)
          </button>
          <button
            type="button"
            onClick={() => handleTabClick('external')}
            className={`px-4 py-2.5 font-bold text-sm transition-colors border-b-2 cursor-pointer ${
              activeResultType === 'external'
                ? 'text-[#4338ca] border-[#4338ca]'
                : 'text-slate-500 border-transparent hover:text-slate-800'
            }`}
          >
            External Results (Final Exams)
          </button>
        </div>

        {/* Sort dropdown */}
        <div className="flex items-center gap-2 text-xs text-slate-600 pb-1">
          <span className="font-semibold">Sort by:</span>
          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value as any)}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs outline-none focus:border-indigo-500"
          >
            <option value="code">Subject Code</option>
            <option value="name">Subject Name</option>
            <option value="marks">Marks Achieved</option>
            <option value="attendance">Attendance %</option>
          </select>
        </div>
      </div>

      {/* Overview Cards (Authoritative values from DB) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Term SGPA */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Semester {student.semester} SGPA
          </span>
          <div className="text-2xl font-black text-[#4338ca] mt-1">
            {displaySGPA}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {academicData?.calculatedSGPA !== null && academicData?.calculatedSGPA !== undefined
              ? 'Calculated from published marks and subject credits'
              : `No published marks for Semester ${student.semester}`}
          </p>
        </div>

        {/* Cumulative GPA (CGPA) */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Cumulative GPA (CGPA)
          </span>
          <div className="text-2xl font-black text-emerald-600 mt-1">
            {displayCGPA}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {student.cgpa > 0 ? 'Verified in institutional student register' : 'Not yet recorded in registry'}
          </p>
        </div>

        {/* Attendance */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Attendance Eligibility
          </span>
          <div className="text-2xl font-black text-slate-900 mt-1">
            {attendanceValue !== null ? `${attendanceValue}%` : 'N/A'}
          </div>
          <p className="text-xs mt-1 flex items-center gap-1">
            {attendanceValue !== null && attendanceValue >= 75 ? (
              <span className="text-emerald-600 font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                Eligible for semester exams (Above 75% target)
              </span>
            ) : attendanceValue !== null ? (
              <span className="text-amber-600 font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">warning</span>
                Below 75% minimum threshold
              </span>
            ) : (
              <span className="text-slate-400">
                No attendance sessions logged for this term
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-600">table_chart</span>
            {activeResultType === 'internal'
              ? `Semester ${student.semester} Internal Assessment`
              : `Semester ${student.semester} Final Examination Grade Sheet`}
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            Showing {sortedList.length} subjects
          </span>
        </div>

        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center text-slate-500">
            <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin mb-3" />
            <p className="text-xs font-medium">Querying Supabase academic tables...</p>
          </div>
        ) : sortedList.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">fact_check</span>
            <h4 className="font-bold text-slate-700">
              No {activeResultType === 'internal' ? 'Internal' : 'External'} Results Found
            </h4>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              No published marks or examination results were found in the database for Semester {student.semester}.
              Results will appear here as soon as exams and marks are published by faculty.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold text-xs uppercase tracking-wider">
                  <th className="p-3.5 pl-4">Subject Code</th>
                  <th className="p-3.5">Subject Name</th>
                  <th className="p-3.5 text-center">Credits</th>
                  <th className="p-3.5 text-right">Marks Secured</th>
                  <th className="p-3.5 text-center">Attendance</th>
                  <th className="p-3.5 text-center">Grade</th>
                  <th className="p-3.5 text-center pr-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {sortedList.map((subject) => (
                  <tr key={subject.code} className="hover:bg-indigo-50/30 transition-colors">
                    <td className="p-3.5 pl-4 font-mono font-bold text-[#4338ca]">
                      {subject.code}
                    </td>
                    <td className="p-3.5 font-semibold text-slate-900">{subject.name}</td>
                    <td className="p-3.5 text-center font-mono">{subject.credits}</td>
                    <td className="p-3.5 text-right font-bold text-slate-900">
                      {subject.internalMarks} / {subject.maxInternalMarks}
                    </td>
                    <td className="p-3.5 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                          subject.attendancePercent >= 75
                            ? 'bg-emerald-50 text-emerald-700'
                            : subject.attendancePercent > 0
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {subject.attendancePercent > 0 ? `${subject.attendancePercent}%` : 'N/A'}
                      </span>
                    </td>
                    <td className="p-3.5 text-center font-black text-indigo-600">
                      {subject.grade}
                    </td>
                    <td className="p-3.5 text-center pr-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase border ${
                          subject.status === 'Pass'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                      >
                        {subject.status}
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
};
