/** INT-003-C11..C13: practitioner shares follow the assignment. */
@IsTest
private class ApplicationAccessServiceTest {

    @IsTest
    static void shareFollowsAssignmentStatus() {
        PtsfTestData.Scenario s = PtsfTestData.build();
        Id app = s.appA1.Id;
        Id p1 = s.practitioner1User.Id;
        Id p2 = s.practitioner2User.Id;
        System.runAs(s.owner) {
            Assessment__c a = PtsfTestData.newAssessment(s.appA1, s.practitioner1, 'Allocated');
            insert a;
            Assert.areEqual(1, PtsfTestData.shareCount(app, p1), 'Allocated grants');

            setStatus(a, 'Accepted');
            Assert.areEqual(1, PtsfTestData.shareCount(app, p1), 'Accepted keeps');
            setStatus(a, 'Submitted');
            Assert.areEqual(1, PtsfTestData.shareCount(app, p1), 'Submitted keeps');
            setStatus(a, 'Closed');
            Assert.areEqual(0, PtsfTestData.shareCount(app, p1), 'Closed revokes');

            setStatus(a, 'Allocated');
            setStatus(a, 'Declined');
            Assert.areEqual(0, PtsfTestData.shareCount(app, p1), 'Declined revokes');
            setStatus(a, 'Allocated');
            setStatus(a, 'Timed_Out');
            Assert.areEqual(0, PtsfTestData.shareCount(app, p1), 'Timed out revokes');

            setStatus(a, 'Allocated');
            a.Practitioner__c = s.practitioner2.Id;
            update a;
            Assert.areEqual(0, PtsfTestData.shareCount(app, p1), 'Previous practitioner loses access');
            Assert.areEqual(1, PtsfTestData.shareCount(app, p2), 'New practitioner gains access');

            delete a;
            Assert.areEqual(0, PtsfTestData.shareCount(app, p2), 'Deleting the assessment revokes');
            undelete a;
            Assert.areEqual(1, PtsfTestData.shareCount(app, p2), 'Undeleting restores');

            Assessment__c second = PtsfTestData.newAssessment(s.appA1, s.practitioner2, 'Accepted');
            insert second;
            setStatus(a, 'Declined');
            Assert.areEqual(1, PtsfTestData.shareCount(app, p2), 'A remaining assigned assessment keeps access');
            setStatus(second, 'Closed');
            Assert.areEqual(0, PtsfTestData.shareCount(app, p2), 'No assigned assessment left revokes');
        }
    }

    @IsTest
    static void bulkRecomputeTwoHundred() {
        PtsfTestData.Scenario s = PtsfTestData.build();
        System.runAs(s.owner) {
            List<Subsidy_Application__c> apps = new List<Subsidy_Application__c>();
            for (Integer i = 0; i < 200; i++) {
                apps.add(PtsfTestData.newApplication(s.patientA, s.owner, 'Bulk ' + i));
            }
            insert apps;
            List<Assessment__c> assessments = new List<Assessment__c>();
            for (Subsidy_Application__c app : apps) {
                assessments.add(PtsfTestData.newAssessment(app, s.practitioner1, 'Allocated'));
            }

            Test.startTest();
            insert assessments;
            for (Assessment__c a : assessments) {
                a.Status__c = 'Declined';
            }
            Integer sharesAfterInsert = countShares(apps, s.practitioner1User.Id);
            update assessments;
            Assert.isTrue(Limits.getQueries() <= 12, 'Recompute stays bulk-safe: ' + Limits.getQueries() + ' queries');
            Test.stopTest();

            Assert.areEqual(200, sharesAfterInsert, 'Every allocated application is shared');
            Assert.areEqual(0, countShares(apps, s.practitioner1User.Id), 'Every declined application is unshared');
        }
    }

    @IsTest
    static void recalcBatchRestoresShares() {
        PtsfTestData.Scenario s = PtsfTestData.build();
        System.runAs(s.owner) {
            insert PtsfTestData.newAssessment(s.appA1, s.practitioner1, 'Accepted');
        }
        delete [SELECT Id FROM Subsidy_Application__Share WHERE RowCause = :Schema.Subsidy_Application__Share.RowCause.Practitioner_Assignment__c];
        Assert.areEqual(0, PtsfTestData.shareCount(s.appA1.Id, s.practitioner1User.Id));

        Test.startTest();
        Database.executeBatch(new ApplicationShareRecalc());
        Test.stopTest();

        Assert.areEqual(1, PtsfTestData.shareCount(s.appA1.Id, s.practitioner1User.Id), 'Recalculation restores the share');
    }

    private static void setStatus(Assessment__c a, String status) {
        a.Status__c = status;
        update a;
    }

    private static Integer countShares(List<Subsidy_Application__c> apps, Id userId) {
        return [
            SELECT COUNT() FROM Subsidy_Application__Share
            WHERE ParentId IN :apps AND UserOrGroupId = :userId
                AND RowCause = :Schema.Subsidy_Application__Share.RowCause.Practitioner_Assignment__c
        ];
    }
}
