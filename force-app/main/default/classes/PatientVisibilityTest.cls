/** INT-003-C2..C5: patients see only their own slice of the data. */
@IsTest
private class PatientVisibilityTest {

    @IsTest
    static void patientSeesOnlyOwnApplications() {
        PtsfTestData.Scenario s = PtsfTestData.build();
        List<Subsidy_Application__c> rows;
        System.runAs(s.patientAUser) {
            rows = [SELECT Id FROM Subsidy_Application__c WITH USER_MODE];
        }
        Assert.areEqual(new Set<Id>{ s.appA1.Id, s.appA2.Id }, new Map<Id, Subsidy_Application__c>(rows).keySet());
        Assert.isFalse(PtsfTestData.hasRead(s.patientAUser.Id, s.appB1.Id), 'Patient A must not read patient B\'s application');
    }

    @IsTest
    static void patientSeesOnlyOwnMedicalHistory() {
        PtsfTestData.Scenario s = PtsfTestData.build();
        List<Medical_History__c> rows;
        System.runAs(s.patientAUser) {
            rows = [SELECT Id FROM Medical_History__c WITH USER_MODE];
        }
        Assert.areEqual(new Set<Id>{ s.historyA1.Id }, new Map<Id, Medical_History__c>(rows).keySet());
        Assert.isFalse(PtsfTestData.hasRead(s.patientAUser.Id, s.historyB1.Id), 'Patient A must not read patient B\'s medical history');
    }

    @IsTest
    static void patientSeesOnlyOwnProfile() {
        PtsfTestData.Scenario s = PtsfTestData.build();
        List<Account> rows;
        System.runAs(s.patientAUser) {
            rows = [SELECT Id FROM Account WITH USER_MODE];
        }
        Assert.areEqual(new Set<Id>{ s.patientA.Id }, new Map<Id, Account>(rows).keySet());
        Assert.isFalse(PtsfTestData.hasRead(s.patientAUser.Id, s.patientB.Id), 'Patient A must not read patient B\'s profile');
    }

    @IsTest
    static void patientCannotReadAssessmentsOrAllocations() {
        PtsfTestData.Scenario s = PtsfTestData.build();
        System.runAs(s.owner) {
            insert PtsfTestData.newAssessment(s.appA1, s.practitioner1, 'Accepted');
            insert new Allocation_Attempt__c(Subsidy_Application__c = s.appA1.Id, Practitioner__c = s.practitioner1.Id);
        }
        System.runAs(s.patientAUser) {
            Assert.isFalse(Schema.SObjectType.Assessment__c.isAccessible(), 'Patients get no assessment access');
            Assert.isFalse(Schema.SObjectType.Allocation_Attempt__c.isAccessible(), 'Patients get no allocation attempt access');
            Assert.isFalse(Schema.SObjectType.Practitioner_Registration__c.isAccessible(), 'Patients get no practitioner registration access');
            Boolean denied = false;
            try {
                List<Assessment__c> rows = [SELECT Id FROM Assessment__c WITH USER_MODE];
            } catch (QueryException e) {
                denied = true;
            }
            Assert.isTrue(denied, 'A user-mode assessment query must be refused for patients');
        }
    }
}
