import { describe, expect, it, vi } from 'vitest'
import { isAbortError, reportError } from './report-error'

describe('reportError', () => {
  it('prints the error message and stack', () => {
    const error = new Error('request failed')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    reportError('assets.load', error)

    expect(spy).toHaveBeenCalledWith('[assets.load] request failed', error.stack)
    spy.mockRestore()
  })

  it('recognizes abort errors for intentional request cancellation', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isAbortError(new Error('aborted'))).toBe(false)
  })
})
