/**
 * Apex sharing recalculation for Subsidy_Application__c. Re-runs the
 * practitioner-access recompute across every application, as a safety net
 * after data loads or fixes.
 */
public without sharing class ApplicationShareRecalc implements Database.Batchable<SObject> {

    public Database.QueryLocator start(Database.BatchableContext context) {
        return Database.getQueryLocator('SELECT Id FROM Subsidy_Application__c', AccessLevel.SYSTEM_MODE);
    }

    public void execute(Database.BatchableContext context, List<Subsidy_Application__c> scope) {
        ApplicationAccessService.recompute(new Map<Id, Subsidy_Application__c>(scope).keySet());
    }

    public void finish(Database.BatchableContext context) {
    }
}
