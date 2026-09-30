import { describe, expect, it } from 'vitest'
import {
  loginPasswordRules,
  normalizeAccount,
  registerPasswordRules,
  validateAccount,
  validatePasswordStrength,
} from './credential-rules'

const PASSWORD = 'Abcdefgh1234'
const ruleArg = {} as never

async function expectValid(validator: typeof validateAccount, value: unknown) {
  await expect(validator(ruleArg, value)).resolves.toBeUndefined()
}

async function expectInvalid(
  validator: typeof validateAccount,
  value: unknown,
  hint: string,
) {
  await expect(validator(ruleArg, value)).rejects.toThrow(hint)
}

describe('normalizeAccount', () => {
  it('mirrors the backend transform', () => {
    expect(normalizeAccount('  MyAccount  ')).toBe('myaccount')
    expect(normalizeAccount(undefined)).toBeUndefined()
  })
})

describe('validateAccount', () => {
  it('accepts a valid account', async () => {
    await expectValid(validateAccount, 'creator_01')
    await expectValid(validateAccount, 'a1.2-3')
  })

  it('accepts uppercase input because the backend lowercases it', async () => {
    await expectValid(validateAccount, 'MyAccount')
  })

  it('rejects accounts shorter than 3 characters', async () => {
    await expectInvalid(validateAccount, 'ab', '账号仅支持')
  })

  it('rejects accounts longer than 64 characters', async () => {
    await expectInvalid(validateAccount, 'a'.repeat(65), '账号仅支持')
  })

  it('rejects accounts with illegal characters or illegal first character', async () => {
    await expectInvalid(validateAccount, 'ab cd', '账号仅支持')
    await expectInvalid(validateAccount, '账号123', '账号仅支持')
    await expectInvalid(validateAccount, '_abc', '账号仅支持')
  })

  it('defers empty values to the required rule', async () => {
    await expectValid(validateAccount, '')
  })
})

describe('validatePasswordStrength', () => {
  it('accepts a password meeting every requirement', async () => {
    await expectValid(validatePasswordStrength, PASSWORD)
  })

  it('reports all unmet requirements at once', async () => {
    await expectInvalid(validatePasswordStrength, 'abc', '长度至少 12 位')
    await expect(
      validatePasswordStrength(ruleArg, 'abc'),
    ).rejects.toThrow('包含大写字母、包含数字')
  })

  it('rejects a password missing only the uppercase letter', async () => {
    await expectInvalid(validatePasswordStrength, 'abcdefgh1234', '包含大写字母')
  })

  it('rejects a password missing only the lowercase letter', async () => {
    await expectInvalid(validatePasswordStrength, 'ABCDEFGH1234', '包含小写字母')
  })

  it('defers empty values to the required rule', async () => {
    await expectValid(validatePasswordStrength, '')
  })
})

describe('password rule composition', () => {
  const usesStrengthValidator = (rules: typeof loginPasswordRules) =>
    rules.some(
      (rule) => typeof rule === 'object' && rule.validator === validatePasswordStrength,
    )

  it('enforces strength rules when registering', () => {
    expect(usesStrengthValidator(registerPasswordRules)).toBe(true)
  })

  it('keeps login lenient so existing accounts still work', () => {
    expect(usesStrengthValidator(loginPasswordRules)).toBe(false)
  })
})
