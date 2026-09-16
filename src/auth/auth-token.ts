let accessToken: string | null = null
let unauthorizedHandler: (() => void) | null = null

export function getAccessToken() { return accessToken }
export function setAccessToken(value: string | null) { accessToken = value }
export function setUnauthorizedHandler(handler: (() => void) | null) { unauthorizedHandler = handler }
export function notifyUnauthorized() { unauthorizedHandler?.() }
