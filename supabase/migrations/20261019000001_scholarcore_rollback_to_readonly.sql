-- ==============================================================================
-- ScholarCore College ERP: Clean Rollback to Strict Read-Only State
-- Migration File: supabase/migrations/20261019000001_scholarcore_rollback_to_readonly.sql
-- Description:
--   Completely rolls back write privileges and write-capable policies introduced in
--   20261019000000_scholarcore_role_write_policies.sql, restoring the database
--   access layer to a hardened, verified read-only state for authenticated clients.
--
-- Security Invariants Enforced During Rollback:
--   1. CONTINUOUS RLS PROTECTION: Row Level Security remains strictly ENABLED on all 27 tables.
--      Never disables table row security under any circumstances.
--   2. PERMISSIVE POLICY RECONCILIATION: In PostgreSQL, permissive policies combine via
--      Boolean OR (true OR false = true). To reliably disable write access, all write-capable
--      policies across all 27 tables are explicitly DROPPED.
--   3. ZERO-WRITE GRANTS: All table-wide and column-scoped INSERT, UPDATE, and DELETE privileges
--      are explicitly REVOKED from authenticated, anon, and public roles.
--   4. PRESERVED IMMUTABILITY & INTEGRITY TRIGGERS:
--      Payment immutability triggers (tr_protect_payment_tamper, tr_protect_payment_insert,
--      tr_protect_payment_delete), anti-tamper identity triggers, and sanitized audit triggers
--      are intentionally PRESERVED and NOT dropped. They guarantee financial immutability
--      and audit trail integrity even during read-only operation.
--   5. PRESERVED READ UPTIME: Safe, role-scoped SELECT policies and grants are preserved and
--      verified across all academic catalog and operational tables.
--   6. NON-DESTRUCTIVE: Zero DROP TABLE, TRUNCATE, or data-destructive commands.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- STEP 1: REVOKE ALL WRITE, TRUNCATE, REFERENCES & TRIGGER PRIVILEGES
-- Audits effective table privileges and explicitly strips all inappropriate INSERT,
-- UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER privileges from authenticated, anon, and PUBLIC.
-- In PostgreSQL, table write/structural mutation permissions include INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, and TRIGGER.
-- ------------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated, anon, PUBLIC;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.departments FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.courses FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.subjects FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.classes FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.students FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.faculty FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.timetable FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.enrollments FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.attendance FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.assignments FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.assignment_submissions FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.exams FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.marks FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.fees FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.payments FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.announcements FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.notifications FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.resources FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.lost_found FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.support_tickets FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.events FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.event_registrations FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.placements FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.placement_applications FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.audit_logs FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.admissions_register FROM authenticated, anon, PUBLIC;

-- ------------------------------------------------------------------------------
-- STEP 2: DROP ALL WRITE-CAPABLE ROW LEVEL SECURITY POLICIES ACROSS ALL 27 TABLES
-- ------------------------------------------------------------------------------

-- 1. Profiles
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;

-- 2. Departments
DROP POLICY IF EXISTS "departments_admin_all" ON public.departments;

-- 3. Courses
DROP POLICY IF EXISTS "courses_admin_all" ON public.courses;

-- 4. Subjects
DROP POLICY IF EXISTS "subjects_admin_all" ON public.subjects;

-- 5. Classes
DROP POLICY IF EXISTS "classes_admin_all" ON public.classes;

-- 6. Students
DROP POLICY IF EXISTS "students_admin_all" ON public.students;

-- 7. Faculty
DROP POLICY IF EXISTS "faculty_update_own" ON public.faculty;
DROP POLICY IF EXISTS "faculty_admin_all" ON public.faculty;

-- 8. Timetable
DROP POLICY IF EXISTS "timetable_admin_all" ON public.timetable;

-- 9. Enrollments
DROP POLICY IF EXISTS "enrollments_admin_all" ON public.enrollments;

-- 10. Attendance
DROP POLICY IF EXISTS "attendance_insert_faculty" ON public.attendance;
DROP POLICY IF EXISTS "attendance_update_faculty" ON public.attendance;
DROP POLICY IF EXISTS "attendance_admin_all" ON public.attendance;

-- 11. Assignments
DROP POLICY IF EXISTS "assignments_insert_faculty" ON public.assignments;
DROP POLICY IF EXISTS "assignments_update_faculty" ON public.assignments;
DROP POLICY IF EXISTS "assignments_delete_faculty" ON public.assignments;
DROP POLICY IF EXISTS "assignments_admin_all" ON public.assignments;

-- 12. Assignment Submissions
DROP POLICY IF EXISTS "submissions_insert_student" ON public.assignment_submissions;
DROP POLICY IF EXISTS "submissions_update_student" ON public.assignment_submissions;
DROP POLICY IF EXISTS "submissions_update_faculty" ON public.assignment_submissions;
DROP POLICY IF EXISTS "submissions_grade_faculty" ON public.assignment_submissions;
DROP POLICY IF EXISTS "submissions_admin_all" ON public.assignment_submissions;

-- 13. Exams
DROP POLICY IF EXISTS "exams_admin_all" ON public.exams;

-- 14. Marks
DROP POLICY IF EXISTS "marks_insert_faculty" ON public.marks;
DROP POLICY IF EXISTS "marks_update_faculty" ON public.marks;
DROP POLICY IF EXISTS "marks_admin_all" ON public.marks;

-- 15. Fees
DROP POLICY IF EXISTS "fees_admin_all" ON public.fees;

-- 16. Payments (Disallow all write policies)
DROP POLICY IF EXISTS "payments_no_client_insert" ON public.payments;
DROP POLICY IF EXISTS "payments_no_client_update" ON public.payments;
DROP POLICY IF EXISTS "payments_no_client_delete" ON public.payments;
DROP POLICY IF EXISTS "payments_admin_all" ON public.payments;

-- 17. Announcements
DROP POLICY IF EXISTS "announcements_insert_faculty" ON public.announcements;
DROP POLICY IF EXISTS "announcements_update_faculty" ON public.announcements;
DROP POLICY IF EXISTS "announcements_delete_admin" ON public.announcements;
DROP POLICY IF EXISTS "announcements_admin_all" ON public.announcements;

-- 18. Notifications
DROP POLICY IF EXISTS "notifications_update_read_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_admin" ON public.notifications;
DROP POLICY IF EXISTS "notifications_admin_all" ON public.notifications;

-- 19. Resources
DROP POLICY IF EXISTS "resources_insert_faculty" ON public.resources;
DROP POLICY IF EXISTS "resources_update_faculty" ON public.resources;
DROP POLICY IF EXISTS "resources_delete_faculty" ON public.resources;
DROP POLICY IF EXISTS "resources_admin_all" ON public.resources;

-- 20. Lost & Found
DROP POLICY IF EXISTS "lost_found_insert_authenticated" ON public.lost_found;
DROP POLICY IF EXISTS "lost_found_update_reporter" ON public.lost_found;
DROP POLICY IF EXISTS "lost_found_delete_reporter" ON public.lost_found;
DROP POLICY IF EXISTS "lost_found_admin_all" ON public.lost_found;

-- 21. Support Tickets
DROP POLICY IF EXISTS "tickets_insert_own" ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_update_own" ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_update_admin" ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_admin_all" ON public.support_tickets;

-- 22. Events
DROP POLICY IF EXISTS "events_admin_all" ON public.events;

-- 23. Event Registrations
DROP POLICY IF EXISTS "registrations_insert_own" ON public.event_registrations;
DROP POLICY IF EXISTS "registrations_delete_own" ON public.event_registrations;
DROP POLICY IF EXISTS "registrations_admin_all" ON public.event_registrations;

-- 24. Placements
DROP POLICY IF EXISTS "placements_insert_admin" ON public.placements;
DROP POLICY IF EXISTS "placements_update_admin" ON public.placements;
DROP POLICY IF EXISTS "placements_delete_admin" ON public.placements;
DROP POLICY IF EXISTS "placements_admin_all" ON public.placements;

-- 25. Placement Applications
DROP POLICY IF EXISTS "placement_apps_insert_student" ON public.placement_applications;
DROP POLICY IF EXISTS "placement_apps_delete_student" ON public.placement_applications;
DROP POLICY IF EXISTS "applications_insert_student" ON public.placement_applications;
DROP POLICY IF EXISTS "applications_delete_student" ON public.placement_applications;
DROP POLICY IF EXISTS "placement_applications_admin_all" ON public.placement_applications;

-- 26. Audit Logs
DROP POLICY IF EXISTS "audit_logs_no_insert" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_no_update" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_no_delete" ON public.audit_logs;

-- 27. Admissions Register
DROP POLICY IF EXISTS "admissions_admin_all" ON public.admissions_register;

-- ------------------------------------------------------------------------------
-- STEP 3: PRESERVE PAYMENT IMMUTABILITY & DATABASE INTEGRITY TRIGGERS
-- Invariants: Payment immutability, audit logging, and anti-tamper triggers are
-- intentionally PRESERVED and NOT removed during rollback. They guarantee that
-- even if an administrative role executes SQL, settled financial payments and
-- historic audit records remain strictly immutable and tamper-evident.
-- ------------------------------------------------------------------------------
-- Active integrity triggers preserved:
--   - tr_protect_payment_tamper ON public.payments (strictly preserves settled payments immutability)
--   - tr_protect_payment_insert ON public.payments (blocks non-service-role SUCCESS inserts)
--   - tr_protect_payment_delete ON public.payments (forbids deleting settled payments)
--   - tr_protect_attendance_identity ON public.attendance
--   - tr_protect_marks_identity ON public.marks
--   - tr_protect_announcement_tamper ON public.announcements
--   - tr_protect_notification_tamper ON public.notifications
--   - tr_protect_profile_update ON public.profiles
--   - trig_check_submission_lifecycle ON public.assignment_submissions
--   - tr_audit_* ON audited entities (marks, fees, payments, profiles, students, faculty, etc.)

-- ------------------------------------------------------------------------------
-- STEP 4: PRESERVE & VERIFY CONTINUOUS READ-ONLY ACCESS (SELECT POLICIES & GRANTS)
-- Ensures that demo student, faculty, and admin dashboards continue reading data without error.
-- ------------------------------------------------------------------------------

-- Ensure Row Level Security remains active on all 27 tables
DO $$
DECLARE
  v_tbl RECORD;
BEGIN
  FOR v_tbl IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename IN (
      'departments', 'courses', 'subjects', 'classes', 'students', 'faculty',
      'timetable', 'enrollments', 'attendance', 'assignments', 'assignment_submissions',
      'exams', 'marks', 'fees', 'payments', 'announcements', 'notifications',
      'resources', 'lost_found', 'support_tickets', 'events', 'event_registrations',
      'placements', 'placement_applications', 'audit_logs', 'admissions_register', 'profiles'
    )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_tbl.tablename);
  END LOOP;
END;
$$;

-- Grant SELECT only to authenticated clients
GRANT SELECT ON public.departments TO authenticated;
GRANT SELECT ON public.courses TO authenticated;
GRANT SELECT ON public.subjects TO authenticated;
GRANT SELECT ON public.classes TO authenticated;
GRANT SELECT ON public.students TO authenticated;
GRANT SELECT ON public.faculty TO authenticated;
GRANT SELECT ON public.timetable TO authenticated;
GRANT SELECT ON public.enrollments TO authenticated;
GRANT SELECT ON public.attendance TO authenticated;
GRANT SELECT ON public.assignments TO authenticated;
GRANT SELECT ON public.assignment_submissions TO authenticated;
GRANT SELECT ON public.exams TO authenticated;
GRANT SELECT ON public.marks TO authenticated;
GRANT SELECT ON public.fees TO authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT SELECT ON public.announcements TO authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT SELECT ON public.resources TO authenticated;
GRANT SELECT ON public.lost_found TO authenticated;
GRANT SELECT ON public.support_tickets TO authenticated;
GRANT SELECT ON public.events TO authenticated;
GRANT SELECT ON public.event_registrations TO authenticated;
GRANT SELECT ON public.placements TO authenticated;
GRANT SELECT ON public.placement_applications TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

-- NOTE: public.admissions_register is intentionally NOT granted to authenticated.
-- It remains 100% private to administrators and service-role backend routines.

-- ------------------------------------------------------------------------------
-- STEP 5: REVOKE SEQUENCE WRITE PRIVILEGES
-- Ensures sequences cannot be cycled or mutated by client roles (authenticated, anon, PUBLIC)
-- ------------------------------------------------------------------------------
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated, anon, PUBLIC;

-- ------------------------------------------------------------------------------
-- STEP 6: REVOKE CLIENT EXECUTION OF MUTATING SECURITY DEFINER RPCS
-- Preserves safe read-only helper functions while blocking all client mutating procedures.
-- ------------------------------------------------------------------------------
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM authenticated, anon, PUBLIC;

-- Re-grant EXECUTE strictly on safe read-only helper functions needed for SELECT RLS evaluation
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_faculty() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_student_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_faculty_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_audit_json(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_faculty_class_roster(UUID) TO authenticated;

-- Mutating settlement routines strictly restricted to service_role (zero client execution)
GRANT EXECUTE ON FUNCTION public.settle_online_payment_atomic(TEXT, NUMERIC, UUID, UUID, TEXT, TEXT) TO service_role;

-- Rollback complete: All client writes revoked, sequence mutations disabled, mutating RPCs blocked,
-- payment immutability preserved, RLS continuously active, and read uptime maintained.
