import { act, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { PageLoading } from './PageLoading'

it('shows the loading indicator only once the wait passes 400ms', () => {
  vi.useFakeTimers()
  render(<PageLoading />)
  act(() => vi.advanceTimersByTime(399))
  expect(screen.queryByRole('progressbar')).toBeNull()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeTruthy()
  vi.useRealTimers()
})
