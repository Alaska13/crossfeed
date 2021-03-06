import { handler as cve } from '../cve';
import {
  Organization,
  Domain,
  connectToDatabase,
  Service,
  Vulnerability
} from '../../models';

jest.mock('child_process', () => ({
  spawnSync: () => null,
  execSync: (cmd, { input }) => {
    expect(input).toMatchSnapshot('execSync.input');
    return [
      '0 CVE-2019-10866 cpe:/a:10web:form_maker:1.0.0 9.8 CWE-89',
      '0 CVE-2019-11590 cpe:/a:10web:form_maker:1.0.0 8.8 CWE-352'
    ].join('\n');
  }
}));

jest.mock('fs', () => ({
  promises: {
    readdir: (str) => ['nvdcve-1.1-2019.json.gz'],
    readFile: (str) => ''
  }
}));

jest.mock('zlib', () => ({
  unzipSync: (contents) =>
    Buffer.from(
      JSON.stringify({
        CVE_Items: [
          {
            cve: {
              CVE_data_meta: { ID: 'CVE-2019-10866' },
              description: {
                description_data: [
                  {
                    lang: 'en',
                    value: 'Test description'
                  }
                ]
              },
              references: {
                reference_data: [
                  {
                    url: 'https://example.com',
                    name: 'https://example.com',
                    refsource: 'CONFIRM',
                    tags: ['Patch', 'Vendor Advisory']
                  }
                ]
              }
            }
          }
        ]
      })
    )
}));

const RealDate = Date;

describe('cve', () => {
  beforeAll(async () => {
    await connectToDatabase();
  });
  beforeEach(() => {
    global.Date.now = jest.fn(() => new Date('2019-04-22T10:20:30Z').getTime());
  });

  afterEach(() => {
    global.Date = RealDate;
  });
  test('simple test', async () => {
    const organization = await Organization.create({
      name: 'test-' + Math.random(),
      rootDomains: ['test-' + Math.random()],
      ipBlocks: [],
      isPassive: false
    }).save();
    const name = 'test-' + Math.random();
    const domain = await Domain.create({
      name,
      organization
    }).save();
    const service = await Service.create({
      domain,
      port: 80,
      censysMetadata: {
        manufacturer: '10web',
        product: 'form_maker',
        version: '1.0.0'
      }
    }).save();
    await cve({
      organizationId: organization.id,
      scanId: 'scanId',
      scanName: 'scanName',
      scanTaskId: 'scanTaskId'
    });

    const vulnerabilities = await Vulnerability.find({
      where: {
        domain: domain,
        service: service
      }
    });
    expect(vulnerabilities.length).toEqual(2);
    for (const vulnerability of vulnerabilities) {
      expect(vulnerability).toMatchSnapshot(
        {
          id: expect.any(String),
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
          actions: expect.any(Array)
        },
        'vulnerability'
      );
    }
  });
  test('should exit if no matching domains with cpes', async () => {
    const organization = await Organization.create({
      name: 'test-' + Math.random(),
      rootDomains: ['test-' + Math.random()],
      ipBlocks: [],
      isPassive: false
    }).save();
    const name = 'test-' + Math.random();
    const domain = await Domain.create({
      name,
      organization
    }).save();
    await cve({
      organizationId: organization.id,
      scanId: 'scanId',
      scanName: 'scanName',
      scanTaskId: 'scanTaskId'
    });

    const vulnerabilities = await Vulnerability.find({
      domain
    });
    expect(vulnerabilities.length).toEqual(0);
  });
  test('closes old vulnerabilities', async () => {
    const organization = await Organization.create({
      name: 'test-' + Math.random(),
      rootDomains: ['test-' + Math.random()],
      ipBlocks: [],
      isPassive: false
    }).save();
    const name = 'test-' + Math.random();
    const domain = await Domain.create({
      name,
      organization
    }).save();
    const vulnerability = await Vulnerability.create({
      domain,
      cve: 'CVE-123',
      lastSeen: new Date(new Date().setDate(new Date().getDate() - 7)),
      title: '123',
      description: '123'
    }).save();
    await cve({
      organizationId: organization.id,
      scanId: 'scanId',
      scanName: 'scanName',
      scanTaskId: 'scanTaskId'
    });

    const vuln = await Vulnerability.findOne({
      id: vulnerability.id
    });
    expect(vuln?.state).toEqual('closed');
    expect(vuln?.substate).toEqual('remediated');
  });
  test('does not close new vulnerability', async () => {
    const organization = await Organization.create({
      name: 'test-' + Math.random(),
      rootDomains: ['test-' + Math.random()],
      ipBlocks: [],
      isPassive: false
    }).save();
    const name = 'test-' + Math.random();
    const domain = await Domain.create({
      name,
      organization
    }).save();
    const vulnerability = await Vulnerability.create({
      domain,
      cve: 'CVE-123',
      lastSeen: new Date(),
      title: '123',
      description: '123'
    }).save();
    await cve({
      organizationId: organization.id,
      scanId: 'scanId',
      scanName: 'scanName',
      scanTaskId: 'scanTaskId'
    });

    const vuln = await Vulnerability.findOne({
      id: vulnerability.id
    });
    expect(vuln?.state).toEqual('open');
    expect(vuln?.substate).toEqual('unconfirmed');
  });
  test('populates vulnerability', async () => {
    const organization = await Organization.create({
      name: 'test-' + Math.random(),
      rootDomains: ['test-' + Math.random()],
      ipBlocks: [],
      isPassive: false
    }).save();
    const name = 'test-' + Math.random();
    const domain = await Domain.create({
      name,
      organization
    }).save();
    const vulnerability = await Vulnerability.create({
      domain,
      cve: 'CVE-2019-10866',
      lastSeen: new Date(),
      title: '123',
      needsPopulation: true
    }).save();
    await cve({
      organizationId: organization.id,
      scanId: 'scanId',
      scanName: 'scanName',
      scanTaskId: 'scanTaskId'
    });

    const vuln = await Vulnerability.findOne({
      id: vulnerability.id
    });
    expect(vuln?.description).toEqual('Test description');
    expect(vuln?.references).toEqual([
      {
        url: 'https://example.com',
        name: 'https://example.com',
        source: 'CONFIRM',
        tags: ['Patch', 'Vendor Advisory']
      }
    ]);
  });
});
