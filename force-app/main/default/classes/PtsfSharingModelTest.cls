/** INT-003-C15..C18: the org-level sharing model holds. */
@IsTest
private class PtsfSharingModelTest {

    private static final Map<String, Integer> RANK = new Map<String, Integer>{
        'Private' => 0, 'Read' => 1, 'ReadWrite' => 2, 'ReadWriteTransfer' => 3, 'FullAccess' => 4
    };

    @IsTest
    static void externalNeverMoreOpenThanInternal() {
        Map<String, List<String>> expected = new Map<String, List<String>>{
            'Account' => new List<String>{ 'Private', 'Private' },
            'Contact' => new List<String>{ 'ControlledByParent', 'ControlledByParent' },
            'Subsidy_Application__c' => new List<String>{ 'Private', 'Private' },
            'Assessment__c' => new List<String>{ 'ControlledByParent', 'ControlledByParent' },
            'Medical_History__c' => new List<String>{ 'Private', 'Private' },
            'Allocation_Attempt__c' => new List<String>{ 'Private', 'Private' },
            'Practitioner_Registration__c' => new List<String>{ 'Read', 'Private' },
            'Treatment_Type__c' => new List<String>{ 'Read', 'Read' }
        };
        List<EntityDefinition> entities = [
            SELECT QualifiedApiName, InternalSharingModel, ExternalSharingModel
            FROM EntityDefinition WHERE QualifiedApiName IN :expected.keySet()
        ];
        Assert.areEqual(expected.size(), entities.size());
        for (EntityDefinition e : entities) {
            List<String> models = expected.get(e.QualifiedApiName);
            if (e.QualifiedApiName == 'Contact') {
                // EntityDefinition reports Contact's controlled-by-parent default as the effective Account model.
                Assert.isTrue(new Set<String>{ 'ControlledByParent', 'Private' }.contains(e.InternalSharingModel), 'Contact internal: ' + e.InternalSharingModel);
                Assert.isTrue(new Set<String>{ 'ControlledByParent', 'Private' }.contains(e.ExternalSharingModel), 'Contact external: ' + e.ExternalSharingModel);
                continue;
            }
            Assert.areEqual(models[0], e.InternalSharingModel, e.QualifiedApiName + ' internal');
            Assert.areEqual(models[1], e.ExternalSharingModel, e.QualifiedApiName + ' external');
            if (RANK.containsKey(e.InternalSharingModel) && RANK.containsKey(e.ExternalSharingModel)) {
                Assert.isTrue(RANK.get(e.ExternalSharingModel) <= RANK.get(e.InternalSharingModel), e.QualifiedApiName + ': external is more open than internal');
            }
        }
    }

    @IsTest
    static void profilesUseDecidedLicences() {
        Map<String, String> licenceByProfile = new Map<String, String>();
        for (Profile p : [SELECT Name, UserLicense.Name FROM Profile WHERE Name IN ('PTSF Patient', 'PTSF Practitioner')]) {
            licenceByProfile.put(p.Name, p.UserLicense.Name);
        }
        Assert.areEqual('Customer Community', licenceByProfile.get('PTSF Patient'));
        Assert.areEqual('Customer Community Plus', licenceByProfile.get('PTSF Practitioner'));
    }

    @IsTest
    static void hierarchyDoesNotGrantMedicalHistory() {
        User manager;
        UserRole managerRole;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            managerRole = new UserRole(Name = 'PTSF Test Manager');
            insert managerRole;
            manager = PtsfTestData.newUser(PtsfTestData.profileId('Standard User'), 'mgr', managerRole.Id, null);
            insert manager;
            PermissionSet readHistory = new PermissionSet(Name = 'Test_Read_Medical_History', Label = 'Test Read Medical History');
            insert readHistory;
            insert new ObjectPermissions(ParentId = readHistory.Id, SobjectType = 'Medical_History__c', PermissionsRead = true);
            insert new PermissionSetAssignment(AssigneeId = manager.Id, PermissionSetId = readHistory.Id);
        }
        User owner = PtsfTestData.createOwner(managerRole.Id);
        Medical_History__c history;
        System.runAs(owner) {
            Account practice = new Account(Name = 'Hierarchy Practice', RecordTypeId = PtsfTestData.recordTypeId('Practice'));
            insert practice;
            history = new Medical_History__c(Patient__c = practice.Id, OwnerId = owner.Id);
            insert history;
        }
        Assert.isFalse(PtsfTestData.hasRead(manager.Id, history.Id), 'A manager above the owner must not inherit medical history access');
    }

    @IsTest
    static void noInt003PermsetGrantsMedicalHistory() {
        List<ObjectPermissions> grants = [
            SELECT Parent.Name, Parent.Profile.Name
            FROM ObjectPermissions
            WHERE SobjectType = 'Medical_History__c' AND PermissionsRead = true
                AND (Parent.Name IN ('PTSF_Practitioner_Access', 'PTSF_Staff_Core') OR Parent.Profile.Name = 'PTSF Practitioner')
        ];
        Assert.isTrue(grants.isEmpty(), 'INT-003 grants no medical history access to practitioners or staff: ' + grants);
    }
}
