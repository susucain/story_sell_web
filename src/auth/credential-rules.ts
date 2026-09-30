import type { Rule, RuleObject } from 'antd/es/form'

/**
 * 账号与密码的前端校验规则。
 *
 * 规则必须与后端 DTO 保持一致，避免前端放行、后端报错的割裂体验：
 * - 账号：nest-langchain/src/auth/account.ts
 * - 注册：nest-langchain/src/auth/dto/register.dto.ts
 * - 登录：nest-langchain/src/auth/dto/login.dto.ts
 */

/** 首字符不能是下划线、点或短横线；`\p{Script=Han}` 需要 `u` 标志。 */
export const ACCOUNT_PATTERN = /^[\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9_.-]{2,63}$/u
export const ACCOUNT_ERROR = '账号仅支持 3-64 位中文、字母、数字、下划线、点或短横线，且不能以下划线、点或短横线开头'
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

/** 与后端 normalizeAccount 一致：先去空白再转小写，因此输入大写字母不应直接判错。 */
export function normalizeAccount(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value
}

export function validateAccount(_: RuleObject, value: unknown): Promise<void> {
  if (!value) return Promise.resolve()
  return ACCOUNT_PATTERN.test(String(normalizeAccount(value)))
    ? Promise.resolve()
    : Promise.reject(new Error(ACCOUNT_ERROR))
}

/** 一次性列出所有未满足的强度要求，避免用户逐个试错。 */
export function validatePasswordStrength(_: RuleObject, value: unknown): Promise<void> {
  if (!value) return Promise.resolve()

  const password = String(value)
  const requirements: Array<[boolean, string]> = [
    [password.length >= PASSWORD_MIN_LENGTH, `长度至少 ${PASSWORD_MIN_LENGTH} 位`],
    [/[a-z]/.test(password), '包含小写字母'],
    [/[A-Z]/.test(password), '包含大写字母'],
    [/\d/.test(password), '包含数字'],
  ]
  const unmet = requirements.filter(([passed]) => !passed).map(([, label]) => label)

  return unmet.length
    ? Promise.reject(new Error(`密码需满足：${unmet.join('、')}`))
    : Promise.resolve()
}

export const accountRules: Rule[] = [
  { required: true, message: '请输入账号' },
  { validator: validateAccount },
]

/** 注册密码：后端强制长度 12-128 且同时包含大小写字母与数字。 */
export const registerPasswordRules: Rule[] = [
  { required: true, message: '请输入密码' },
  { max: PASSWORD_MAX_LENGTH, message: `密码长度不能超过 ${PASSWORD_MAX_LENGTH} 位` },
  { validator: validatePasswordStrength },
]

/** 登录密码只校验非空与长度上限，存量账号不受新强度规则约束。 */
export const loginPasswordRules: Rule[] = [
  { required: true, message: '请输入密码' },
  { max: PASSWORD_MAX_LENGTH, message: `密码长度不能超过 ${PASSWORD_MAX_LENGTH} 位` },
]

export const confirmPasswordRules: Rule[] = [
  { required: true, message: '请再次输入密码' },
  ({ getFieldValue }) => ({
    validator: (_, value) =>
      !value || getFieldValue('password') === value
        ? Promise.resolve()
        : Promise.reject(new Error('两次输入的密码不一致')),
  }),
]
