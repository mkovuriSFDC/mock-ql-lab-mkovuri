/**
 * Keeps practitioner read access to Subsidy_Application__c in step with their
 * assessments (INT-003). A practitioner's portal user holds a
 * Practitioner_Assignment__c share while at least one of their assessments on
 * the application is in an assigned status.
 *
 * Recomputes desired state rather than reacting to single events, so it is
 * idempotent and handles several assessments per practitioner.
 * Runs without sharing and in system mode (explicit, since API 67.0 defaults
 * to user mode): the trigger can fire from a practitioner's own action, and
 * portal users can't read share objects or every assessment on the application.
 */
public without sharing class ApplicationAccessService {

    /** Statuses that count as "assigned" (design Q-design-1, ratified 2026-10-20). */
    public static final Set<String> ASSIGNED_STATUSES = new Set<String>{ 'Allocated', 'Accepted', 'Submitted' };

    private static final String ROW_CAUSE = Schema.Subsidy_Application__Share.RowCause.Practitioner_Assignment__c;

    public static void recompute(Set<Id> applicationIds) {
        Set<Id> ids = new Set<Id>(applicationIds);
        ids.remove(null);
        if (ids.isEmpty()) {
            return;
        }

        List<Assessment__c> assigned = [
            SELECT Subsidy_Application__c, Practitioner__c
            FROM Assessment__c
            WHERE Subsidy_Application__c IN :ids
                AND Practitioner__c != null
                AND Status__c IN :ASSIGNED_STATUSES
            WITH SYSTEM_MODE
        ];
        Set<Id> contactIds = new Set<Id>();
        for (Assessment__c a : assigned) {
            contactIds.add(a.Practitioner__c);
        }
        Map<Id, Id> userIdByContactId = new Map<Id, Id>();
        for (User u : [SELECT Id, ContactId FROM User WHERE ContactId IN :contactIds AND IsActive = true WITH SYSTEM_MODE]) {
            userIdByContactId.put(u.ContactId, u.Id);
        }

        Set<String> desired = new Set<String>();
        for (Assessment__c a : assigned) {
            Id userId = userIdByContactId.get(a.Practitioner__c);
            if (userId != null) {
                desired.add(key(a.Subsidy_Application__c, userId));
            }
        }

        List<Subsidy_Application__Share> toDelete = new List<Subsidy_Application__Share>();
        Set<String> existing = new Set<String>();
        for (Subsidy_Application__Share s : [
            SELECT Id, ParentId, UserOrGroupId
            FROM Subsidy_Application__Share
            WHERE ParentId IN :ids AND RowCause = :ROW_CAUSE
            WITH SYSTEM_MODE
        ]) {
            String k = key(s.ParentId, s.UserOrGroupId);
            if (desired.contains(k)) {
                existing.add(k);
            } else {
                toDelete.add(s);
            }
        }

        List<Subsidy_Application__Share> toInsert = new List<Subsidy_Application__Share>();
        for (String k : desired) {
            if (!existing.contains(k)) {
                List<String> parts = k.split(':');
                toInsert.add(new Subsidy_Application__Share(
                    ParentId = parts[0],
                    UserOrGroupId = parts[1],
                    AccessLevel = 'Read',
                    RowCause = ROW_CAUSE
                ));
            }
        }

        if (!toDelete.isEmpty()) {
            delete as system toDelete;
        }
        if (!toInsert.isEmpty()) {
            insert as system toInsert;
        }
    }

    private static String key(Id applicationId, Id userId) {
        return applicationId + ':' + userId;
    }
}
