const fs = require('fs');
const util = require('util');
const neatCsv = require('neat-csv');
const ipaddr = require('ipaddr.js');
const IPCIDR = require('ip-cidr');

/**
 * IP Filtering utility class
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

  constructor(options = {}) {
    this.names = [];
    this.ipv4 = [];
    this.ipv6 = [];
  }

  toJSON() {
    return {names: this.names, ipv4: this.ipv4, ipv6: this.ipv6};
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
      throw new Error(`Invalid IP: ${ipStartString} (${name})`);
    } else if (!ipaddr.isValid(ipEndString)) {
      throw new Error(`Invalid IP: ${ipEndString} (${name})`);
    } else {
      const ipStart = ipaddr.parse(ipStartString);
      const ipEnd = ipaddr.parse(ipEndString);
      if (ipStart.kind() !== ipEnd.kind()) {
        throw new Error(`Mismatched IP range: ${ipStartString} - ${ipEndString} (${name})`);
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
      throw new Error(`Invalid CIDR: ${cidrString} (${name})`);
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
      throw new Error(`Invalid Fixed IP Range: ${ipStart} - ${ipEnd} (${name})`);
    }
    if (ipStart > ipEnd) {
      throw new Error(`Non-sequential IP Range: ${ipStart} - ${ipEnd} (${name})`)
    }

    // search for space in list
    let idx = 0;
    for (idx; idx < list.length; idx++) {
      if (ipEnd < list[idx][0]) {
        break; // insert here
      } else if (ipStart > list[idx][1]) {
        // keep looking
      } else {
        throw new Error(`IP Range Conflict: [${ipStart}, ${ipEnd}, ${name}] ` +
          `conflicts with [${list[idx][0]}, ${list[idx][1]}, ${list[idx][2]}]`);
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

}
