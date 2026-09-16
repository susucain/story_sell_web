import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { UserMenu } from './UserMenu'

describe('UserMenu', () => {
  it('shows the current account and exposes logout', async () => {
    render(
      <MemoryRouter>
        <UserMenu account="creator" onLogout={async () => {}} />
      </MemoryRouter>,
    )

    await screen.findByText('creator')
    expect(screen.getByLabelText('用户菜单')).toBeTruthy()
  })
})
