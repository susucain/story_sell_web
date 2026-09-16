import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { RequireAuth } from './RequireAuth'

describe('RequireAuth', () => {
  it('redirects an unauthenticated user to login', async () => {
    render(
      <MemoryRouter initialEntries={['/life-video']}>
        <AuthProvider initialState={{ isLoading: false }}>
          <Routes>
            <Route path="/login" element={<div>登录页</div>} />
            <Route element={<RequireAuth />}>
              <Route path="/life-video" element={<div>工作台</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('登录页')).toBeTruthy()
  })
})
