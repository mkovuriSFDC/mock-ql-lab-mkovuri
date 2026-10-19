/** INT-003-C6, C8..C10, C14: practitioners see only the allowed slice of assigned applications. */
@IsTest
private class PractitionerVisibilityTest {

    @IsTest
    static void assignedPractitionerReadsContactDetails() {
        PtsfTestData.Scenario s = PtsfTestData.build();
        System.runAs(s.owner) {
            insert PtsfTestData.newAssessment(s.appA1, s.practitioner1, 'Accepted');
        }
        List<Subsidy_Application__c> rows;
        System.runAs(s.practitioner1User) {
            rows = [
                SELECT Id, Patient_Name__c, Patient_Phone__c, Patient_Email__c, Service_Description__c
                FROM Subsidy_Application__c WITH USER_MODE
            ];
            Assert.isTrue(Schema.SObjectType.Subsidy_Application__c.fields.Patient_Name__c.isAccessible());
            Assert.isTrue(Schema.SObjectType.Subsidy_Application__c.fields.Patient_Phone__c.isAccessible());
            Assert.isTrue(Schema.SObjectType.Subsidy_Application__c.fields.Patient_Email__c.isAccessible());
            Assert.isTrue(Schema.SObjectType.Subsidy_Application__c.fields.Service_Description__c.isAccessible());
        }
        Assert.areEqual(1, rows.size(), 'Practitioner sees only the assigned application');
        Assert.areEqual(s.appA1.Id, rows[0].Id);
        Assert.areEqual('Aiko Tan', rows[0].Patient_Name__c);
        Assert.areEqual('aiko@example.com.test', rows[0].Patient_Email__c);
        Assert.isNotNull(rows[0].Patient_Phone__c);
        Assert.areEqual('Return flight for treatment', rows[0].Service_Description__c);
    }

    @IsTest
    static void practitionerCannotReadPatientAccount() {
        PtsfTestData.Scenario s = PtsfTestData.build();
        System.runAs(s.owner) {
            insert PtsfTestData.newAssessment(s.appA1, s.practitioner1, 'Accepted');
        }
        Assert.isFalse(PtsfTestData.hasRead(s.practitioner1User.Id, s.patientA.Id), 'No record access to the patient account');
        System.runAs(s.practitioner1User) {
            Assert.isFalse(Schema.SObjectType.Subsidy_Application__c.fields.Patient__c.isAccessible(), 'Patient lookup is hidden');
            Assert.isFalse(Schema.SObjectType.Subsidy_Application__c.fields.Treatment_Type__c.isAccessible(), 'Treatment type is hidden (Q-design-3)');

            List<Account> accounts = new List<Account>();
            try {
                accounts = [SELECT Id, PersonBirthdate, PersonMailingStreet FROM Account WHERE Id = :s.patientA.Id WITH USER_MODE];
            } catch (QueryException e) {
                accounts = new List<Account>();
            }
            Assert.isTrue(accounts.isEmpty(), 'Patient account, date of birth and address are unreachable');

            List<Subsidy_Application__c> apps = [SELECT Id, Patient__c FROM Subsidy_Application__c];
            SObjectAccessDecision decision = Security.stripInaccessible(AccessType.READABLE, apps);
            Assert.isTrue(decision.getRemovedFields().get('Subsidy_Application__c').contains('Patient__c'), 'Patient lookup is stripped');
        }
    }

    @IsTest
    static void practitionerReadsAllAssessmentsOnAssignedApplication() {
        PtsfTestData.Scenario s = PtsfTestData.build();
        Assessment__c own;
        Assessment__c specialist;
        System.runAs(s.owner) {
            own = PtsfTestData.newAssessment(s.appA1, s.practitioner1, 'Accepted');
            specialist = PtsfTestData.newAssessment(s.appA1, s.practitioner2, 'Allocated');
            insert new List<Assessment__c>{ own, specialist };
        }
        List<Assessment__c> rows;
        System.runAs(s.practitioner1User) {
            rows = [SELECT Id FROM Assessment__c WITH USER_MODE];
        }
        Assert.areEqual(new Set<Id>{ own.Id, specialist.Id }, new Map<Id, Assessment__c>(rows).keySet());
    }

    @IsTest
    static void unassignedPractitionerReadsNothing() {
        PtsfTestData.Scenario s = PtsfTestData.build();
        System.runAs(s.owner) {
            insert new List<Assessment__c>{
                PtsfTestData.newAssessment(s.appA1, s.practitioner1, 'Accepted'),
                PtsfTestData.newAssessment(s.appA1, s.practitioner3, 'Declined')
            };
        }
        System.runAs(s.practitioner3User) {
            Assert.areEqual(0, [SELECT COUNT() FROM Subsidy_Application__c WITH USER_MODE]);
            Assert.areEqual(0, [SELECT COUNT() FROM Assessment__c WITH USER_MODE]);
        }
    }

    @IsTest
    static void practitionerCannotEditApplicationOrAssessment() {
        PtsfTestData.Scenario s = PtsfTestData.build();
        Assessment__c own;
        System.runAs(s.owner) {
            own = PtsfTestData.newAssessment(s.appA1, s.practitioner1, 'Accepted');
            insert own;
        }
        System.runAs(s.practitioner1User) {
            Boolean appDenied = false;
            try {
                Database.update(new Subsidy_Application__c(Id = s.appA1.Id, Service_Description__c = 'changed'), AccessLevel.USER_MODE);
            } catch (Exception e) {
                appDenied = true;
            }
            Boolean assessmentDenied = false;
            try {
                Database.update(new Assessment__c(Id = own.Id, Status__c = 'Submitted'), AccessLevel.USER_MODE);
            } catch (Exception e) {
                assessmentDenied = true;
            }
            Assert.isTrue(appDenied, 'Practitioners cannot edit applications');
            Assert.isTrue(assessmentDenied, 'Practitioners cannot edit assessments in this increment');
        }
    }
}
