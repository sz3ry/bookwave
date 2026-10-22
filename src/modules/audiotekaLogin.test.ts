import { describe, expect, test } from 'bun:test';
import { parseAuthenticateRequest } from './audiotekaLogin';

// Hand-trimmed, redacted body of the audioteka.com web login request.
const WEB_BODY = JSON.stringify({
  name: 'AuthenticateForWeb',
  device_id: 'd1',
  email: 'x',
  password: 'y',
  catalog_id: 'c',
  recaptcha_token: 't',
});

describe('parseAuthenticateRequest', () => {
  test('accepts the web login body', () => {
    expect(parseAuthenticateRequest(WEB_BODY)).toEqual({ deviceId: 'd1' });
  });

  test('rejects the mobile Authenticate command', () => {
    expect(
      parseAuthenticateRequest(JSON.stringify({ name: 'Authenticate', device_id: 'd1' })),
    ).toBe(null);
  });

  test('rejects other commands', () => {
    expect(
      parseAuthenticateRequest(JSON.stringify({ name: 'RefreshToken', device_id: 'd1' })),
    ).toBe(null);
  });

  test('rejects malformed JSON and a missing body', () => {
    expect(parseAuthenticateRequest('{"name":"AuthenticateForWeb",')).toBe(null);
    expect(parseAuthenticateRequest(undefined)).toBe(null);
    expect(parseAuthenticateRequest('null')).toBe(null);
  });

  test('rejects a missing or non-string device id', () => {
    expect(parseAuthenticateRequest(JSON.stringify({ name: 'AuthenticateForWeb' }))).toBe(null);
    expect(
      parseAuthenticateRequest(JSON.stringify({ name: 'AuthenticateForWeb', device_id: 42 })),
    ).toBe(null);
    expect(
      parseAuthenticateRequest(JSON.stringify({ name: 'AuthenticateForWeb', device_id: '' })),
    ).toBe(null);
  });
});
