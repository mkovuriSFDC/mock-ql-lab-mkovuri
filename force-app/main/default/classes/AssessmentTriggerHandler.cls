/**
 * Single entry point for Assessment__c trigger logic. INT-003 recomputes
 * practitioner access to the parent application; later intents (INT-001)
 * add their services here rather than adding a second trigger.
 */
public with sharing class AssessmentTriggerHandler {

    public static void handle(List<Assessment__c> newList, Map<Id, Assessment__c> oldMap, System.TriggerOperation operation) {
        Set<Id> applicationIds = new Set<Id>();
        switch on operation {
            when AFTER_INSERT, AFTER_UNDELETE {
                for (Assessment__c a : newList) {
                    applicationIds.add(a.Subsidy_Application__c);
                }
            }
            when AFTER_UPDATE {
                for (Assessment__c a : newList) {
                    Assessment__c before = oldMap.get(a.Id);
                    if (a.Practitioner__c != before.Practitioner__c || a.Status__c != before.Status__c) {
                        applicationIds.add(a.Subsidy_Application__c);
                    }
                }
            }
            when AFTER_DELETE {
                for (Assessment__c a : oldMap.values()) {
                    applicationIds.add(a.Subsidy_Application__c);
                }
            }
        }
        ApplicationAccessService.recompute(applicationIds);
    }
}
