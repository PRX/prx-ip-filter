const fs = require('fs');
const util = require('util');
const PrxIpFilter = require('./index');

describe('PrxIpFilter', () => {

  // skip s3 tests without creds
  const itHasS3Creds = (process.env.TEST_S3_BUCKET && process.env.TEST_S3_PREFIX) ? it : xit;

  let filter;
  beforeEach(() => filter = new PrxIpFilter());

  it('adds v4 ranges', () => {
    expect(filter.addRange('5.5.5.5', '5.5.6.5', 'Zero')).toEqual(0);
    expect(filter.addRange('5.5.21.5', '5.5.22.5', 'One')).toEqual(1);
    expect(filter.addRange('5.5.19.5', '5.5.20.5', 'Two')).toEqual(1);
    expect(filter.addRange('5.5.5.4', '5.5.5.4', 'Three')).toEqual(0);
    expect(filter.names).toEqual(['Zero', 'One', 'Two', 'Three']);
    expect(filter.ipv4).toEqual([
      ['005.005.005.004', '005.005.005.004', 3],
      ['005.005.005.005', '005.005.006.005', 0],
      ['005.005.019.005', '005.005.020.005', 2],
      ['005.005.021.005', '005.005.022.005', 1]
    ]);
  });

  it('adds v6 ranges', () => {
    expect(filter.addRange('1234:5:6::', '1234:5:7::', 'Zero')).toEqual(0);
    expect(filter.addRange('1234:12:3::', '1234:34:5::', 'One')).toEqual(1);
    expect(filter.names).toEqual(['Zero', 'One']);
    expect(filter.ipv6).toEqual([
      ['1234:0005:0006:0000:0000:0000:0000:0000', '1234:0005:0007:0000:0000:0000:0000:0000', 0],
      ['1234:0012:0003:0000:0000:0000:0000:0000', '1234:0034:0005:0000:0000:0000:0000:0000', 1]
    ]);
  });

  it('adds v4 cidrs', () => {
    expect(filter.addCidr('1.2.5.0/24')).toEqual(0);
    expect(filter.addCidr('1.2.4.0/24')).toEqual(0);
    expect(filter.names).toEqual(['unknown']);
    expect(filter.ipv4).toEqual([
      ['001.002.004.000', '001.002.004.255', 0],
      ['001.002.005.000', '001.002.005.255', 0]
    ]);
  });

  it('adds v6 cidrs', () => {
    expect(filter.addCidr('1:2:3:4::/64')).toEqual(0);
    expect(filter.addCidr('1:2:2:4::/64')).toEqual(0);
    expect(filter.names).toEqual(['unknown']);
    expect(filter.ipv6).toEqual([
      ['0001:0002:0002:0004:0000:0000:0000:0000', '0001:0002:0002:0004:ffff:ffff:ffff:ffff', 0],
      ['0001:0002:0003:0004:0000:0000:0000:0000', '0001:0002:0003:0004:ffff:ffff:ffff:ffff', 0]
    ]);
  });

  it('detects invalid ranges', () => {
    expect(() => filter.addRange('foo', 'bar')).toThrow(/invalid ip/i);
    expect(() => filter.addRange('1.1.1.1', '1.1.a.1')).toThrow(/invalid ip/i);
    expect(() => filter.addRange('1:2:3:4::', '1.2::3::5::')).toThrow(/invalid ip/i);
    expect(() => filter.addRange('1.1.1.1', '2:2:2:2::')).toThrow(/mismatched ip range/i);
    expect(() => filter.addRange('2.2.2.2', '1.1.1.1')).toThrow(/non-sequential ip range/i);
  });

  it('detects invalid cidrs', () => {
    expect(() => filter.addCidr('foo')).toThrow(/invalid cidr/i);
    expect(() => filter.addCidr('1.2.a.4/24')).toThrow(/invalid cidr/i);
    expect(() => filter.addCidr('1.2.3.4/99')).toThrow(/invalid cidr/i);
    expect(() => filter.addCidr('1:2:3::4::/40')).toThrow(/invalid cidr/i);
  });

  it('converts ips to fixed length', () => {
    expect(filter.ipToFixed(filter.stringToCleanIp('1.2.3.4'))).toEqual('001.002.003.004');
    expect(filter.ipToFixed(filter.stringToCleanIp('1:2:3:4::'))).toEqual('0001:0002:0003:0004:0000:0000:0000:0000');
  });

  it('cleans x-forwarded-for ips', () => {
    expect(filter.stringToCleanIp('')).toEqual(null);
    expect(filter.stringToCleanIp(',blah')).toEqual(null);
    expect(filter.stringToCleanIp(',99.99.99.99').octets).toEqual([99, 99, 99, 99]);
    expect(filter.stringToCleanIp(', , 66.6.44.4 ,99.99.99.99').octets).toEqual([66, 6, 44, 4]);
  });

  it('logs errors instead of throwing them', () => {
    const messages = [];
    const filter2 = new PrxIpFilter({logger: m => messages.push(m)});

    expect(filter2.addRange('foo', 'bar')).toEqual(-1);
    expect(messages[0]).toMatch(/invalid ip/i);

    expect(filter2.addCidr('foo')).toEqual(-1);
    expect(messages[1]).toMatch(/invalid cidr/i);

    expect(filter2.addRange('2.2.2.2', '2.2.3.3')).toEqual(0);
    expect(filter2.addRange('1.2.3.4', '2.2.2.2')).toEqual(-1);
    expect(messages[2]).toMatch(/range conflict/i);

    expect(filter2.addRange('2.2.2.10', '2.2.2.12')).toEqual(-1);
    expect(messages[3]).toMatch(/range conflict/i);

    expect(filter2.addRange('2.2.2.12', '2.2.4.4')).toEqual(-1);
    expect(messages[4]).toMatch(/range conflict/i);
  });

  describe('with some filter ranges', () => {

    beforeEach(() => {
      filter.addRange('1.1.1.2', '1.1.2.2', 'One');
      filter.addRange('1.1.3.4', '2.1.1.1', 'Two');
      filter.addRange('1:1:2:3::', '1:1:3:4::', 'Three');
      filter.addRange('44:123:0:30::', '44:125:3:31::', 'Four');
    });

    it('returns null for bad matches', () => {
      expect(filter.match('')).toEqual(null);
      expect(filter.match('foo')).toEqual(null);
      expect(filter.match('1.1.1.a')).toEqual(null);
      expect(filter.match('1:1:2:3:::')).toEqual(null);
    });

    it('matches ipv4 ranges', () => {
      expect(filter.match('1.1.1.1')).toEqual(null);
      expect(filter.match('1.1.1.2')).toEqual('One');
      expect(filter.match('1.1.1.255')).toEqual('One');
      expect(filter.match('1.1.2.2')).toEqual('One');
      expect(filter.match('1.1.2.3')).toEqual(null);
      expect(filter.match('1.1.255.255')).toEqual('Two');
      expect(filter.match('2.1.1.2')).toEqual(null);
    });

    it('matches ipv6 ranges', () => {
      expect(filter.match('1:1:2:2:ffff:ffff:ffff:ffff')).toEqual(null);
      expect(filter.match('1:1:2:0003::')).toEqual('Three');
      expect(filter.match('1:1:3:4::')).toEqual('Three');
      expect(filter.match('1:1:3:4:0:0:0:1')).toEqual(null);
      expect(filter.match('44:124::')).toEqual('Four');
    });

    it('matches xff strings', () => {
      expect(filter.match('1.1.1.2, 9.9.9.9')).toEqual('One');
      expect(filter.match('foo, 1.1.1.2, 9.9.9.9')).toEqual('One');
      expect(filter.match('9.9.9.9, 1.1.1.2')).toEqual(null);
    });

    it('gets the actual range of the match', () => {
      expect(filter.matchRange('1.1.1.2')).toEqual({
        start: '001.001.001.002',
        end: '001.001.002.002',
        name: 'One'
      });
    });

    it('round trips json', () => {
      const json = JSON.stringify(filter);
      const filter2 = PrxIpFilter.fromJSON(json);

      expect(filter.names).toEqual(filter2.names);
      expect(filter.ipv4).toEqual(filter2.ipv4);
      expect(filter.ipv6).toEqual(filter2.ipv6);
    });

    it('round trips to a file', async () => {
      await util.promisify(fs.mkdir)(`${__dirname}/tmp`).catch(e => null);
      await util.promisify(fs.unlink)(`${__dirname}/tmp/db.json`).catch(e => null);

      await filter.toFile(`${__dirname}/tmp/db.json`);
      const filter2 = await PrxIpFilter.fromFile(`${__dirname}/tmp/db.json`);

      expect(filter.names).toEqual(filter2.names);
      expect(filter.ipv4).toEqual(filter2.ipv4);
      expect(filter.ipv6).toEqual(filter2.ipv6);
    });

    itHasS3Creds('loads from S3 csv files', async () => {
      const filter2 = await PrxIpFilter.fromS3CSV(process.env.TEST_S3_BUCKET, process.env.TEST_S3_PREFIX);
      expect(filter2.names.length).toBeGreaterThan(0);
      expect(filter2.ipv4.length).toBeGreaterThan(0);
      expect(filter2.ipv6.length).toBeGreaterThan(0);
    });

  });

})
