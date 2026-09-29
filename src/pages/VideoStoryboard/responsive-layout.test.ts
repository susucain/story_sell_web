import { describe, expect, it } from 'vitest'
import { getWorkspaceMode } from './responsive-layout'

describe('getWorkspaceMode', () => {
  it('uses the desktop shell at 1280px and above', () => {
    expect(getWorkspaceMode(1280)).toBe('desktop')
  })

  it('uses the tablet shell between 768px and 1279px', () => {
    expect(getWorkspaceMode(1024)).toBe('tablet')
    expect(getWorkspaceMode(768)).toBe('tablet')
  })

  it('uses the mobile shell below 768px', () => {
    expect(getWorkspaceMode(767)).toBe('mobile')
    expect(getWorkspaceMode(390)).toBe('mobile')
  })
})
