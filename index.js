const fs = require('fs');
const util = require('util');
const ipaddr = require('ipaddr.js');
const IPCIDR = require('ip-cidr');
const neatCsv = require('neat-csv');
const s3 = new (require('aws-sdk')).S3();

/**
 * IP Filtering utility class
 *
 * Constructor options:
 *   logger - log ip parsing/range errors using this function rather than
 *            throwing them (default: null, meaning throw them)
 */
module.exports = class PrxIpFilter {

  static fromJSON(stringOrObject, options = {}) {
    const obj = typeof(stringOrObject) === 'object' ? stringOrObject : JSON.parse(stringOrObject);
    const filter = new PrxIpFilter(options);
    filter.names = obj.names || [];
    filter.ipv4 = obj.ipv4 || [];
    filter.ipv6 = obj.ipv6 || [];
    return filter;
  }

  static async fromFile(path, options = {}) {
    const buffer = await util.promisify(fs.readFile)(path);
    return PrxIpFilter.fromJSON(buffer.toString());
  }

  static async fromS3CSV(bucket, prefix, options = {}) {
    const resp = await s3.listObjects({Bucket: bucket, Prefix: prefix}).promise();
    const keys = resp.Contents.map(c => c.Key).filter(k => k.endsWith('.csv'));
    const csvs = await Promise.all(keys.map(async (key) => {
      const csvResp = await s3.getObject({Bucket: bucket, Key: key}).promise();
      return await neatCsv(csvResp.Body.toString(), {headers: ['0', '1', '2', '3']});
    }));

    const filter = new PrxIpFilter(options);
    csvs.forEach(csv => {
      csv.forEach(row => {
        if (ipaddr.isValid(row['0']) && ipaddr.isValid(row['1'])) {
          filter.addRange(row['0'], row['1'], row['2']);
        } else {
          filter.addCidr(row['0'], row['1']);
        }
      });
    });
    return filter;
  }

  constructor(options = {}) {
    this.names = [];
    this.ipv4 = [];
    this.ipv6 = [];
    this.logger = options.logger || null;
  }

  toJSON() {
    return {names: this.names, ipv4: this.ipv4, ipv6: this.ipv6};
  }

  toFile(path) {
    return util.promisify(fs.writeFile)(path, JSON.stringify(this));
  }

  // match an ip/xff string against database
  matchRange(ipString) {
    const cleanIp = this.stringToCleanIp(ipString);
    if (cleanIp) {
      const list = cleanIp.kind() === 'ipv6' ? this.ipv6 : this.ipv4;
      const fixed = this.ipToFixed(cleanIp);

      // binary search of sorted range list
      let low = 0;
      let high = list.length - 1;
      while (high >= low) {
        const probe = Math.floor((high + low) / 2);
        const [startIp, endIp, idx] = list[probe];
        if (startIp > fixed) {
          high = probe - 1;
        } else if (endIp < fixed) {
          low = probe + 1;
        } else {
          return {start: startIp, end: endIp, name: this.names[idx]};
        }
      }
    }
    return null;
  }

  // get only the matched name
  match(ipString) {
    const matchedRange = this.matchRange(ipString);
    return matchedRange ? matchedRange.name : null;
  }

  addRange(ipStartString, ipEndString, name = 'unknown') {
    if (!ipaddr.isValid(ipStartString)) {
      this.log(`Invalid IP: ${ipStartString} (${name})`);
      return -1;
    } else if (!ipaddr.isValid(ipEndString)) {
      this.log(`Invalid IP: ${ipEndString} (${name})`);
      return -1;
    } else {
      const ipStart = ipaddr.parse(ipStartString);
      const ipEnd = ipaddr.parse(ipEndString);
      if (ipStart.kind() !== ipEnd.kind()) {
        this.log(`Mismatched IP range: ${ipStartString} - ${ipEndString} (${name})`);
        return -1;
      } else {
        const fixedStart = this.ipToFixed(ipStart);
        const fixedEnd = this.ipToFixed(ipEnd);
        return this.addFixedRange(fixedStart, fixedEnd, name);
      }
    }
  }

  addCidr(cidrString, name = 'unknown') {
    const cidr = new IPCIDR(cidrString);
    if (!cidr.isValid()) {
      this.log(`Invalid CIDR: ${cidrString} (${name})`);
      return -1;
    } else {
      return this.addRange(cidr.start(), cidr.end(), name);
    }
  }

  ipToFixed(ip) {
    if (ip.kind() === 'ipv6') {
      return ip.toFixedLengthString();
    } else {
      return ip.octets.map(n => `00${n}`.substr(-3, 3)).join('.');
    }
  }

  stringToCleanIp(ipString) {
    const parts = (ipString || '').split(',').map(s => s.trim());
    const cleaned = parts.filter(s => s && ipaddr.isValid(s));
    return cleaned[0] ? ipaddr.parse(cleaned[0]) : null;
  }

  addFixedRange(ipStart, ipEnd, name) {
    let list = null;
    if (ipStart.length === 15 && ipEnd.length === 15) {
      list = this.ipv4;
    } else if (ipStart.length === 39 && ipEnd.length === 39) {
      list = this.ipv6;
    } else {
      this.log(`Invalid Fixed IP Range: ${ipStart} - ${ipEnd} (${name})`);
      return -1;
    }
    if (ipStart > ipEnd) {
      this.log(`Non-sequential IP Range: ${ipStart} - ${ipEnd} (${name})`)
      return -1;
    }

    // search for space in list
    let idx = 0;
    for (idx; idx < list.length; idx++) {
      if (ipEnd < list[idx][0]) {
        break; // insert here
      } else if (ipStart > list[idx][1]) {
        // keep looking
      } else {
        this.log(`IP Range Conflict: [${ipStart}, ${ipEnd}, ${name}] ` +
          `conflicts with [${list[idx][0]}, ${list[idx][1]}, ${list[idx][2]}]`);
        return -1;
      }
    }
    list.splice(idx, 0, [ipStart, ipEnd, this.addNameIndex(name)]);
    return idx;
  }

  addNameIndex(name) {
    let idx = this.names.indexOf(name);
    if (idx < 0) {
      idx = this.names.length;
      this.names.push(name);
    }
    return idx;
  }

  log(message) {
    if (this.logger) {
      this.logger(message);
    } else {
      throw new PrxIpFilterError(message);
    }
  }

}

/**
 * Custom error override
 */
function PrxIpFilterError(message) {
  this.name = 'PrxIpFilterError';
  this.message = message;
  this.stack = (new Error()).stack;
}
PrxIpFilterError.prototype = new Error;
