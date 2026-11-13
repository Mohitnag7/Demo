import React, { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import {
  TabType,
  StudentProfile,
  UserProfile,
  UserRole,
  Notice,
  UpcomingEvent,
  FeeItem,
  PaymentReceipt,
  ResourceItem,
  AssignmentItem,
  LostFoundItem,
  NotificationItem,
  SupportTicket,
} from './types';
import {
  INITIAL_STUDENT_PROFILE,
  INITIAL_NOTICES,
  INITIAL_EVENTS,
  INITIAL_FEES,
  INITIAL_PAYMENT_HISTORY,
  INITIAL_RESOURCES,
  INITIAL_ASSIGNMENTS,
  INITIAL_LOST_FOUND,
  INITIAL_NOTIFICATION_FEED,
  INITIAL_SUPPORT_TICKETS,
  getMockDataForSemester,
} from './data/mockData';

import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { AIAssistantWidget } from './components/AIAssistantWidget';

import { DashboardView } from './components/DashboardView';
import { LoginView } from './components/LoginView';
import { FacultyView } from './components/FacultyView';
import { AdminView } from './components/AdminView';
import { AcademicsView } from './components/AcademicsView';
import { FeesView } from './components/FeesView';
import { ResourcesView } from './components/ResourcesView';
import { LostFoundView } from './components/LostFoundView';
import { NotificationsView } from './components/NotificationsView';
import { SupportView } from './components/SupportView';

import { ReportItemModal } from './components/ReportItemModal';
import { PaymentModal } from './components/PaymentModal';
import { SubmitAssignmentModal } from './components/SubmitAssignmentModal';
import { NotificationsModal } from './components/NotificationsModal';
import { fetchStudentFees } from './lib/academic-data';

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [student, setStudent] = useState<StudentProfile>(INITIAL_STUDENT_PROFILE);
  const [activeTab, setActiveTabState] = useState<TabType>(() => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const saved = window.sessionStorage.getItem('scholarcore_active_tab') as TabType;
      if (saved) return saved;
    }
    return 'dashboard';
  });

  const setActiveTab = (tab: TabType) => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem('scholarcore_active_tab', tab);
    }
    setActiveTabState(tab);
  };

  const [resultsSubTab, setResultsSubTabState] = useState<'internal' | 'external'>(() => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const saved = window.sessionStorage.getItem('scholarcore_results_subtab') as 'internal' | 'external';
      if (saved === 'internal' || saved === 'external') return saved;
    }
    return 'internal';
  });

  const handleResultsSubTabChange = (subTab: 'internal' | 'external') => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem('scholarcore_results_subtab', subTab);
    }
    setResultsSubTabState(subTab);
  };

  const [searchQuery, setSearchQuery] = useState('');

  /**
   * Authoritatively loads the user profile from the database using their authenticated UID.
   * Fails safely if the profile is missing, duplicated, or has an unauthorized role.
   */
  const loadUserProfile = async (user: User) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id);

      if (error) {
        console.error('Database error fetching user profile:', error.message);
        setAuthError(
          `Database error loading profile: ${error.message}. Please verify the profiles table and RLS permissions.`
        );
        await supabase.auth.signOut();
        setCurrentUser(null);
        return;
      }

      if (!data || data.length === 0) {
        setAuthError(
          `Configuration error: No ERP profile found for authenticated account (${user.email}). User ID ${user.id} has not been provisioned in the profiles table.`
        );
        await supabase.auth.signOut();
        setCurrentUser(null);
        return;
      }

      if (data.length > 1) {
        setAuthError(
          `Data integrity violation: Multiple profile records found for User ID ${user.id}. Please contact the database administrator.`
        );
        await supabase.auth.signOut();
        setCurrentUser(null);
        return;
      }

      const profile = data[0];
      const role = (profile.role || '').toLowerCase() as UserRole;

      if (role !== 'student' && role !== 'faculty' && role !== 'admin') {
        setAuthError(
          `Access denied: Invalid or unauthorized role '${profile.role}' assigned to account ${user.email}. Only student, faculty, and admin roles are permitted.`
        );
        await supabase.auth.signOut();
        setCurrentUser(null);
        return;
      }

      let idNumber = profile.id_number || profile.idNumber || user.id.slice(0, 8);
      let department = profile.department || 'Computer Science & Engineering';

      // Look up linked student or faculty details if present
      let studentDbId: string | undefined = undefined;
      if (role === 'student') {
        const { data: studentRecord, error: studentError } = await supabase
          .from('students')
          .select('id, roll_number, student_id, semester, department_id, course_id, class_id, cgpa, attendance_percentage, pending_dues, paid_amount, scholarship_amount')
          .eq('profile_id', user.id)
          .maybeSingle();

        if (studentError) {
          console.warn('Error fetching student record:', studentError.message);
        }

        if (studentRecord) {
          studentDbId = studentRecord.id;
          idNumber = studentRecord.roll_number || studentRecord.student_id || idNumber;
          setStudent((prev) => ({
            ...prev,
            dbId: studentRecord.id,
            name: profile.full_name || profile.name || user.email?.split('@')[0] || prev.name,
            rollNo: idNumber,
            department: profile.department || prev.department,
            avatar: profile.avatar_url || profile.avatar || prev.avatar,
            semester: studentRecord.semester || prev.semester,
            cgpa: studentRecord.cgpa !== null && studentRecord.cgpa !== undefined ? Number(studentRecord.cgpa) : prev.cgpa,
            attendancePercent: studentRecord.attendance_percentage !== null && studentRecord.attendance_percentage !== undefined ? Number(studentRecord.attendance_percentage) : prev.attendancePercent,
            pendingDues: studentRecord.pending_dues !== null && studentRecord.pending_dues !== undefined ? Number(studentRecord.pending_dues) : prev.pendingDues,
            paidAmount: studentRecord.paid_amount !== null && studentRecord.paid_amount !== undefined ? Number(studentRecord.paid_amount) : prev.paidAmount,
            scholarshipAmount: studentRecord.scholarship_amount !== null && studentRecord.scholarship_amount !== undefined ? Number(studentRecord.scholarship_amount) : prev.scholarshipAmount,
          }));
        }
      }

      let facultyDbId: string | undefined = undefined;
      if (role === 'faculty') {
        const { data: facultyRecord, error: facultyError } = await supabase
          .from('faculty')
          .select('id, faculty_id, designation, department_id')
          .eq('profile_id', user.id)
          .maybeSingle();

        if (facultyError) {
          console.warn('Error fetching faculty record:', facultyError.message);
        }

        if (facultyRecord) {
          facultyDbId = facultyRecord.id;
          idNumber = facultyRecord.faculty_id || idNumber;

          if (facultyRecord.department_id) {
            const { data: dept } = await supabase
              .from('departments')
              .select('name')
              .eq('id', facultyRecord.department_id)
              .maybeSingle();
            if (dept?.name) {
              department = dept.name;
            }
          }
        }
      }

      const userProfile: UserProfile = {
        dbId: role === 'faculty' ? facultyDbId : role === 'student' ? studentDbId || student.dbId : undefined,
        name: profile.full_name || profile.name || user.email?.split('@')[0] || 'User',
        idNumber: idNumber,
        role: role,
        department: department,
        avatar:
          profile.avatar_url ||
          profile.avatar ||
          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=250',
        email: profile.email || user.email || '',
      };

      setCurrentUser(userProfile);
      setAuthError(null);

      // Route view stably to authoritative role without resetting user's selected tab
      setActiveTabState((prevTab) => {
        const validStudentTabs: TabType[] = ['dashboard', 'academics', 'results', 'fees', 'resources', 'lost-found', 'settings', 'support', 'notifications'];
        const validFacultyTabs: TabType[] = ['faculty-dashboard', 'grading', 'resources', 'support', 'lost-found', 'settings', 'notifications'];
        const validAdminTabs: TabType[] = ['admin-dashboard', 'student-mgmt', 'fee-audit', 'exam-control', 'support', 'resources', 'settings', 'notifications'];

        if (role === 'student' && validStudentTabs.includes(prevTab)) {
          return prevTab;
        }
        if (role === 'faculty' && validFacultyTabs.includes(prevTab)) {
          return prevTab;
        }
        if (role === 'admin' && validAdminTabs.includes(prevTab)) {
          return prevTab;
        }

        const defaultTab: TabType = role === 'faculty' ? 'faculty-dashboard' : role === 'admin' ? 'admin-dashboard' : 'dashboard';
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem('scholarcore_active_tab', defaultTab);
        }
        return defaultTab;
      });
    } catch (err: any) {
      console.error('Exception loading user profile:', err);
      setAuthError('An unexpected error occurred while loading your profile from the database.');
      await supabase.auth.signOut();
      setCurrentUser(null);
    }
  };

  // Restore authenticated session and listen for session changes
  useEffect(() => {
    let isMounted = true;

    const restoreSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          console.warn('Session restoration error:', error.message);
        }
        if (session?.user && isMounted) {
          await loadUserProfile(session.user);
        }
      } catch (err) {
        console.error('Failed to restore session:', err);
      } finally {
        if (isMounted) setAuthLoading(false);
      }
    };

    restoreSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (session?.user && isMounted) {
          await loadUserProfile(session.user);
        }
      } else if (event === 'SIGNED_OUT') {
        if (isMounted) setCurrentUser(null);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleLogin = (user: UserProfile) => {
    // Only used for controlled dev role switching if enabled
    setCurrentUser(user);
    const defaultTab: TabType = user.role === 'faculty' ? 'faculty-dashboard' : user.role === 'admin' ? 'admin-dashboard' : 'dashboard';
    setActiveTab(defaultTab);
    if (user.role === 'student') {
      setStudent((prev) => ({
        ...prev,
        name: user.name,
        rollNo: user.idNumber,
        department: user.department,
        avatar: user.avatar,
      }));
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Error signing out of Supabase:', err);
    }
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem('scholarcore_active_tab');
      window.sessionStorage.removeItem('scholarcore_results_subtab');
    }
    setCurrentUser(null);
    setAuthError(null);
    setActiveTabState('dashboard');
  };

  const [notices, setNotices] = useState<Notice[]>(INITIAL_NOTICES);
  const [events, setEvents] = useState<UpcomingEvent[]>(INITIAL_EVENTS);
  const [fees, setFees] = useState<FeeItem[]>(INITIAL_FEES);
  const [history, setHistory] = useState<PaymentReceipt[]>(INITIAL_PAYMENT_HISTORY);
  const [resources, setResources] = useState<ResourceItem[]>(INITIAL_RESOURCES);
  const [assignments, setAssignments] = useState<AssignmentItem[]>(INITIAL_ASSIGNMENTS);
  const [lostFoundItems, setLostFoundItems] = useState<LostFoundItem[]>(INITIAL_LOST_FOUND);
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATION_FEED);
  const [tickets, setTickets] = useState<SupportTicket[]>(INITIAL_SUPPORT_TICKETS);

  const [internalResults, setInternalResults] = useState(getMockDataForSemester(INITIAL_STUDENT_PROFILE.semester).internalResults);
  const [externalResults, setExternalResults] = useState(getMockDataForSemester(INITIAL_STUDENT_PROFILE.semester).externalResults);

  const handleSemesterChange = (newSemester: number) => {
    setStudent((prev) => ({
      ...prev,
      semester: newSemester,
    }));
  };

  // UI Drawer & Widget States
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInitialPrompt, setAiInitialPrompt] = useState<string | undefined>(undefined);

  // Modal States
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedFeeForPayment, setSelectedFeeForPayment] = useState<FeeItem | undefined>(undefined);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<AssignmentItem | undefined>(undefined);
  const [notificationsModalOpen, setNotificationsModalOpen] = useState(false);

  // Toast Banner State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [feeRefreshCounter, setFeeRefreshCounter] = useState<number>(0);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const handleOpenAIAssistantWithPrompt = (promptText?: string) => {
    if (promptText) {
      setAiInitialPrompt(promptText);
    }
    setAiOpen(true);
  };

  // Handlers
  const handlePaymentSuccess = async (
    amountPaid: number,
    feeTitle: string,
    method: string,
    receiptNo?: string
  ) => {
    const finalReceiptNo = receiptNo || `#REC-${Date.now().toString().slice(-6)}`;
    const newReceipt: PaymentReceipt = {
      receiptNo: finalReceiptNo,
      feeType: feeTitle,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      method,
      amount: amountPaid,
      status: 'SUCCESS',
    };

    setHistory((prev) => [newReceipt, ...prev]);

    // Update student pending dues
    setStudent((prev) => ({
      ...prev,
      pendingDues: Math.max(0, prev.pendingDues - amountPaid),
      paidAmount: prev.paidAmount + amountPaid,
    }));

    // Update fee items locally
    setFees((prev) =>
      prev.map((f) => {
        if (selectedFeeForPayment ? f.id === selectedFeeForPayment.id : f.balance > 0) {
          const newPaid = f.paid + amountPaid;
          const newBal = Math.max(0, f.amount - newPaid);
          return {
            ...f,
            paid: newPaid,
            balance: newBal,
            status: newBal === 0 ? 'FULLY PAID' : 'PARTIALLY PAID',
          };
        }
        return f;
      })
    );

    // Increment refresh trigger for child components
    setFeeRefreshCounter((c) => c + 1);

    // Authoritatively re-fetch live fees and payment records from Supabase
    if (student.dbId) {
      try {
        const liveData = await fetchStudentFees(student.dbId, student.semester);
        if (liveData) {
          setFees(liveData.fees);
          setHistory(liveData.payments);
          setStudent((prev) => ({
            ...prev,
            pendingDues: liveData.totalDues,
            paidAmount: liveData.totalPaid,
          }));
        }
      } catch (err) {
        console.warn('Failed to refresh authoritative fee records from database:', err);
      }
    }

    showToast(`Payment of ₹${amountPaid.toLocaleString('en-IN')} successfully settled! Receipt ${finalReceiptNo} issued.`);
  };

  const handleDownloadReceipt = (receiptNo: string) => {
    showToast(`Downloading PDF receipt (${receiptNo})...`);
  };

  const handleDownloadResource = (title: string) => {
    showToast(`Downloading file: "${title}"`);
  };

  const handleAssignmentSubmit = (assignmentId: string, fileName: string) => {
    setAssignments((prev) =>
      prev.map((a) =>
        a.id === assignmentId ? { ...a, status: 'Submitted', grade: 'Pending Grading' } : a
      )
    );
    showToast(`Assignment submitted successfully with file: ${fileName}`);
  };

  const handleAddLostFoundItem = (newItem: Partial<LostFoundItem>) => {
    const fullItem: LostFoundItem = {
      id: `lf_${Date.now()}`,
      title: newItem.title || 'Untitled Item',
      category: newItem.category || 'Personal Belongings',
      type: newItem.type || 'lost',
      location: newItem.location || 'Campus Main Gate',
      reporter: newItem.reporter || 'Arjun Kumar (You)',
      timeAgo: 'Just now',
      isOwnerListing: true,
      description: newItem.description || '',
    };

    setLostFoundItems((prev) => [fullItem, ...prev]);
    showToast(`Listing published: "${fullItem.title}"`);
  };

  const handleClaimItem = (title: string) => {
    showToast(`Claim inquiry sent to finder for "${title}".`);
  };

  const handleIFoundThis = (title: string) => {
    showToast(`Alert sent to owner regarding lost item "${title}".`);
  };

  const handleRSVPEvent = (eventId: string) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, rsvpd: true } : e))
    );
    showToast('RSVP confirmed! Event added to your campus calendar.');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0b1326] flex flex-col items-center justify-center text-white font-sans">
        <div className="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4" />
        <h2 className="text-lg font-bold text-slate-200">ScholarCore ERP</h2>
        <p className="text-xs text-slate-400">Verifying authenticated session...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginView
        onLogin={handleLogin}
        authError={authError}
        onClearAuthError={() => setAuthError(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col md:flex-row antialiased">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 border border-slate-700 animate-in fade-in slide-in-from-top-4 duration-200">
          <span className="material-symbols-outlined text-emerald-400">check_circle</span>
          <span className="text-sm font-medium">{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-white ml-2">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenAIAssistant={() => setAiOpen(true)}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        desktopOpen={desktopOpen}
        onLogout={handleLogout}
        currentUser={currentUser}
      />

      {/* Main Container */}
      <div className={`flex-1 flex flex-col min-h-screen bg-[#F8FAFC] transition-all duration-300 ${desktopOpen ? 'md:ml-64' : 'md:ml-0'}`}>
        {/* Top App Bar Header */}
        <Header
          student={student}
          currentUser={currentUser}
          onLogout={handleLogout}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onToggleMobileMenu={() => setMobileOpen(true)}
          onToggleDesktopMenu={() => setDesktopOpen(!desktopOpen)}
          onOpenNotifications={() => setNotificationsModalOpen(true)}
          onOpenAIAssistant={() => setAiOpen(true)}
          unreadCount={notifications.filter((n) => n.unread).length}
        />

        {/* Main Canvas Views */}
        <main className="flex-1 p-4 md:p-6 lg:p-8">
          {/* Faculty Views */}
          {(activeTab === 'faculty-dashboard' ||
            (activeTab === 'dashboard' && currentUser?.role === 'faculty')) && (
            <FacultyView
              currentUser={currentUser}
              activeTab="faculty-dashboard"
              searchQuery={searchQuery}
              onShowToast={showToast}
              onNavigateTab={setActiveTab}
            />
          )}

          {activeTab === 'grading' && (
            <FacultyView
              currentUser={currentUser}
              activeTab="grading"
              searchQuery={searchQuery}
              onShowToast={showToast}
              onNavigateTab={setActiveTab}
            />
          )}

          {/* Admin Views */}
          {(activeTab === 'admin-dashboard' ||
            (activeTab === 'dashboard' && currentUser?.role === 'admin')) && (
            <AdminView
              currentUser={currentUser}
              activeTab="admin-dashboard"
              searchQuery={searchQuery}
              onShowToast={showToast}
              onNavigateTab={setActiveTab}
            />
          )}

          {(activeTab === 'student-mgmt' || activeTab === 'fee-audit' || activeTab === 'exam-control') && (
            <AdminView
              currentUser={currentUser}
              activeTab={activeTab}
              searchQuery={searchQuery}
              onShowToast={showToast}
              onNavigateTab={setActiveTab}
            />
          )}

          {/* Student Views */}
          {activeTab === 'dashboard' && currentUser?.role === 'student' && (
            <DashboardView
              student={student}
              notices={notices}
              events={events}
              onNavigateTab={setActiveTab}
              onOpenAIPrompt={handleOpenAIAssistantWithPrompt}
              onSemesterChange={handleSemesterChange}
              onRSVPEvent={handleRSVPEvent}
            />
          )}

          {(activeTab === 'academics' || activeTab === 'results') && (
            <AcademicsView
              student={student}
              searchQuery={searchQuery}
              onSemesterChange={handleSemesterChange}
              subTab={resultsSubTab}
              onSubTabChange={handleResultsSubTabChange}
              internalResults={internalResults}
              externalResults={externalResults}
            />
          )}

          {activeTab === 'fees' && (
            <FeesView
              student={student}
              fees={fees}
              history={history}
              onOpenPaymentModal={(f) => {
                setSelectedFeeForPayment(f);
                setPaymentModalOpen(true);
              }}
              onDownloadReceipt={handleDownloadReceipt}
              searchQuery={searchQuery}
              onSemesterChange={handleSemesterChange}
              refreshTrigger={feeRefreshCounter}
            />
          )}

          {activeTab === 'resources' && (
            <ResourcesView
              student={student}
              resources={resources}
              assignments={assignments}
              searchQuery={searchQuery}
              onOpenSubmitAssignmentModal={(a) => {
                setSelectedAssignment(a);
                setSubmitModalOpen(true);
              }}
              onDownloadResource={handleDownloadResource}
            />
          )}

          {activeTab === 'lost-found' && (
            <LostFoundView
              items={lostFoundItems}
              searchQuery={searchQuery}
              onOpenReportModal={() => setReportModalOpen(true)}
              onClaimItem={handleClaimItem}
              onIFoundThis={handleIFoundThis}
            />
          )}

          {activeTab === 'notifications' && (
            <NotificationsView
              notifications={notifications}
              setNotifications={setNotifications}
              onDownloadReceipt={handleDownloadReceipt}
              onDownloadResource={handleDownloadResource}
              onNavigateTab={setActiveTab}
              onOpenAIAssistant={handleOpenAIAssistantWithPrompt}
              onShowToast={showToast}
            />
          )}

          {activeTab === 'settings' && (
            <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-4 max-w-2xl">
              <h2 className="text-xl font-bold text-slate-900">Student Portal Preferences</h2>
              <p className="text-sm text-slate-500">
                Manage your profile settings, notification preferences, and portal appearance.
              </p>

              <div className="space-y-3 pt-2 text-sm">
                <div className="flex justify-between items-center py-2 border-b">
                  <span>Email Notifications for Notices & Exam Updates</span>
                  <input type="checkbox" defaultChecked className="w-4 h-4 text-indigo-600 rounded" />
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span>SMS Alerts for Fee Due Reminders</span>
                  <input type="checkbox" defaultChecked className="w-4 h-4 text-indigo-600 rounded" />
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span>Dark Mode Preference</span>
                  <input type="checkbox" className="w-4 h-4 text-indigo-600 rounded" />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'support' && (
            <SupportView
              tickets={tickets}
              setTickets={setTickets}
              onShowToast={showToast}
              onNavigateTab={setActiveTab}
              onOpenAIAssistant={handleOpenAIAssistantWithPrompt}
            />
          )}
        </main>
      </div>

      {/* Floating AI Assistant Widget */}
      <AIAssistantWidget
        isOpen={aiOpen}
        onToggle={() => setAiOpen((prev) => !prev)}
        initialPrompt={aiInitialPrompt}
        onClearInitialPrompt={() => setAiInitialPrompt(undefined)}
      />

      {/* Modals */}
      <NotificationsModal
        isOpen={notificationsModalOpen}
        onClose={() => setNotificationsModalOpen(false)}
        notifications={notifications}
        setNotifications={setNotifications}
        onDownloadReceipt={handleDownloadReceipt}
        onDownloadResource={handleDownloadResource}
        onNavigateTab={setActiveTab}
        onOpenAIAssistant={handleOpenAIAssistantWithPrompt}
        onShowToast={showToast}
      />

      <ReportItemModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        onSubmit={handleAddLostFoundItem}
      />

      <PaymentModal
        isOpen={paymentModalOpen}
        feeItem={selectedFeeForPayment}
        totalPending={student.pendingDues}
        availableFees={fees}
        student={student}
        onClose={() => {
          setPaymentModalOpen(false);
          setSelectedFeeForPayment(undefined);
        }}
        onSuccess={handlePaymentSuccess}
      />

      <SubmitAssignmentModal
        isOpen={submitModalOpen}
        assignment={selectedAssignment}
        onClose={() => {
          setSubmitModalOpen(false);
          setSelectedAssignment(undefined);
        }}
        onSubmit={handleAssignmentSubmit}
      />
    </div>
  );
}
