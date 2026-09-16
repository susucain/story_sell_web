import { LogoutOutlined, UserOutlined } from '@ant-design/icons'
import { Dropdown } from 'antd'
import type { MenuProps } from 'antd'

type UserMenuProps = {
  account: string
  onLogout: () => Promise<void>
}

export function UserMenu({ account, onLogout }: UserMenuProps) {
  const items: MenuProps['items'] = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: () => void onLogout(),
    },
  ]

  return (
    <Dropdown menu={{ items }} trigger={['click']} placement="topLeft">
      <button className="lj-user-menu" type="button" aria-label="用户菜单">
        <span className="lj-user-menu__avatar"><UserOutlined /></span>
        <span className="lj-user-menu__account">{account}</span>
      </button>
    </Dropdown>
  )
}
