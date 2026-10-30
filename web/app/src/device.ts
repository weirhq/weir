import { create } from '@bufbuild/protobuf'
import { version } from '../package.json'
import {
  DeviceInfoSchema,
  type DeviceInfo
} from './gen/weir/api/v1alpha/auth_pb'

/** A short name for this browser, e.g. "Firefox on macOS". */
export function describeBrowser(userAgent: string): string {
  const browser =
    [
      ['Firefox', /Firefox\//],
      ['Edge', /Edg\//],
      ['Chrome', /Chrome\//],
      ['Safari', /Safari\//]
    ].find(([, pattern]) => (pattern as RegExp).test(userAgent))?.[0] ??
    'Browser'
  const os =
    [
      ['iOS', /iPhone|iPad/],
      ['Android', /Android/],
      ['macOS', /Mac OS X/],
      ['Windows', /Windows/],
      ['Linux', /Linux/]
    ].find(([, pattern]) => (pattern as RegExp).test(userAgent))?.[0] ?? ''
  return os ? `${browser} on ${os}` : (browser as string)
}

export function deviceInfo(deviceId: string): DeviceInfo {
  return create(DeviceInfoSchema, {
    deviceId,
    name: describeBrowser(globalThis.navigator?.userAgent ?? ''),
    client: 'weir-web',
    clientVersion: version
  })
}
