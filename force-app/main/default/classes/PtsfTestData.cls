/**
 * Test data for the INT-003 visibility model: an internal record owner with a
 * role, two patients on the high-volume licence, and three practitioners on
 * Customer Community Plus under one practice. Setup and record DML run in
 * separate runAs blocks to avoid mixed DML.
 */
@IsTest
public class PtsfTestData {

    public class Scenario {
        public User owner;
        public Account patientA;
        public Account patientB;
        public Account practice;
        public User patientAUser;
        public User patientBUser;
        public Contact practitioner1;
        public Contact practitioner2;
        public Contact practitioner3;
        public User practitioner1User;
        public User practitioner2User;
        public User practitioner3User;
        public Subsidy_Application__c appA1;
        public Subsidy_Application__c appA2;
        public Subsidy_Application__c appB1;
        public Medical_History__c historyA1;
        public Medical_History__c historyB1;
    }

    private static Integer counter = 0;

    public static Scenario build() {
        Scenario s = new Scenario();
        s.owner = createOwner(null);

        System.runAs(s.owner) {
            s.patientA = newPatient('Aiko', 'Tan');
            s.patientB = newPatient('Ben', 'Lim');
            s.practice = new Account(Name = 'Test Practice', RecordTypeId = recordTypeId('Practice'), OwnerId = s.owner.Id);
            insert new List<Account>{ s.patientA, s.patientB, s.practice };

            s.practitioner1 = new Contact(AccountId = s.practice.Id, FirstName = 'Lena', LastName = 'Okafor', Email = 'p1@example.com.test');
            s.practitioner2 = new Contact(AccountId = s.practice.Id, FirstName = 'Sam', LastName = 'Specialist', Email = 'p2@example.com.test');
            s.practitioner3 = new Contact(AccountId = s.practice.Id, FirstName = 'Una', LastName = 'Assigned', Email = 'p3@example.com.test');
            insert new List<Contact>{ s.practitioner1, s.practitioner2, s.practitioner3 };

            s.appA1 = newApplication(s.patientA, s.owner, 'Return flight for treatment');
            s.appA2 = newApplication(s.patientA, s.owner, 'Train fare for follow-up');
            s.appB1 = newApplication(s.patientB, s.owner, 'Taxi to clinic');
            insert new List<Subsidy_Application__c>{ s.appA1, s.appA2, s.appB1 };

            s.historyA1 = new Medical_History__c(Patient__c = s.patientA.Id, Subsidy_Application__c = s.appA1.Id, OwnerId = s.owner.Id);
            s.historyB1 = new Medical_History__c(Patient__c = s.patientB.Id, Subsidy_Application__c = s.appB1.Id, OwnerId = s.owner.Id);
            insert new List<Medical_History__c>{ s.historyA1, s.historyB1 };
        }

        Map<Id, Account> persons = new Map<Id, Account>([
            SELECT Id, PersonContactId FROM Account WHERE Id IN :new Set<Id>{ s.patientA.Id, s.patientB.Id }
        ]);

        System.runAs(new User(Id = UserInfo.getUserId())) {
            Id patientProfile = profileId('PTSF Patient');
            Id practitionerProfile = profileId('PTSF Practitioner');
            s.patientAUser = newUser(patientProfile, 'pata', null, persons.get(s.patientA.Id).PersonContactId);
            s.patientBUser = newUser(patientProfile, 'patb', null, persons.get(s.patientB.Id).PersonContactId);
            s.practitioner1User = newUser(practitionerProfile, 'prac1', null, s.practitioner1.Id);
            s.practitioner2User = newUser(practitionerProfile, 'prac2', null, s.practitioner2.Id);
            s.practitioner3User = newUser(practitionerProfile, 'prac3', null, s.practitioner3.Id);
            insert new List<User>{ s.patientAUser, s.patientBUser, s.practitioner1User, s.practitioner2User, s.practitioner3User };
            assignPermissionSet(new List<User>{ s.patientAUser, s.patientBUser }, 'PTSF_Patient_Access');
            assignPermissionSet(new List<User>{ s.practitioner1User, s.practitioner2User, s.practitioner3User }, 'PTSF_Practitioner_Access');
        }
        return s;
    }

    /** An internal record owner with a role (required for accounts with site users). */
    public static User createOwner(Id parentRoleId) {
        User owner;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            UserRole role = new UserRole(Name = 'PTSF Test Owner ' + nextSuffix(), ParentRoleId = parentRoleId);
            insert role;
            owner = newUser(profileId('System Administrator'), 'owner', role.Id, null);
            insert owner;
            assignPermissionSet(new List<User>{ owner }, 'PTSF_Staff_Core');
        }
        return owner;
    }

    public static Assessment__c newAssessment(Subsidy_Application__c app, Contact practitioner, String status) {
        return new Assessment__c(Subsidy_Application__c = app.Id, Practitioner__c = practitioner.Id, Status__c = status);
    }

    public static Subsidy_Application__c newApplication(Account patient, User owner, String serviceDescription) {
        return new Subsidy_Application__c(Patient__c = patient.Id, OwnerId = owner.Id, Service_Description__c = serviceDescription);
    }

    public static Boolean hasRead(Id userId, Id recordId) {
        return [SELECT RecordId, HasReadAccess FROM UserRecordAccess WHERE UserId = :userId AND RecordId = :recordId].HasReadAccess;
    }

    public static Integer shareCount(Id applicationId, Id userId) {
        return [
            SELECT COUNT() FROM Subsidy_Application__Share
            WHERE ParentId = :applicationId AND UserOrGroupId = :userId
                AND RowCause = :Schema.Subsidy_Application__Share.RowCause.Practitioner_Assignment__c
        ];
    }

    public static Id profileId(String name) {
        return [SELECT Id FROM Profile WHERE Name = :name LIMIT 1].Id;
    }

    public static Id recordTypeId(String developerName) {
        return Schema.SObjectType.Account.getRecordTypeInfosByDeveloperName().get(developerName).getRecordTypeId();
    }

    public static User newUser(Id profileId, String label, Id roleId, Id contactId) {
        String suffix = nextSuffix();
        return new User(
            ProfileId = profileId,
            UserRoleId = roleId,
            ContactId = contactId,
            LastName = label,
            Alias = (label + suffix).left(8),
            Email = label + '@example.com.test',
            Username = 'ptsf.' + label + '.' + suffix + '.' + UserInfo.getOrganizationId() + '@example.com.test',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US',
            TimeZoneSidKey = 'Asia/Singapore'
        );
    }

    public static void assignPermissionSet(List<User> users, String permissionSetName) {
        Id psId = [SELECT Id FROM PermissionSet WHERE Name = :permissionSetName].Id;
        List<PermissionSetAssignment> assignments = new List<PermissionSetAssignment>();
        for (User u : users) {
            assignments.add(new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = psId));
        }
        insert assignments;
    }

    private static Account newPatient(String firstName, String lastName) {
        return new Account(
            RecordTypeId = recordTypeId('Patient'),
            FirstName = firstName,
            LastName = lastName,
            PersonEmail = firstName.toLowerCase() + '@example.com.test',
            Phone = '+65 6000 000' + nextSuffix().right(1),
            PersonBirthdate = Date.newInstance(1980, 1, 1)
        );
    }

    private static String nextSuffix() {
        counter++;
        return String.valueOf(counter);
    }
}
