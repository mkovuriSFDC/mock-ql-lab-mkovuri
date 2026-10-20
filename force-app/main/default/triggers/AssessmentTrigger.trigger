trigger AssessmentTrigger on Assessment__c (after insert, after update, after delete, after undelete) {
    AssessmentTriggerHandler.handle(Trigger.new, Trigger.oldMap, Trigger.operationType);
}
