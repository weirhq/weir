import { render, screen } from '@testing-library/react'
import { Button, TextField } from '.'

it('renders button variants and passes props through', () => {
  render(
    <Button variant="tonal" type="submit">
      Save
    </Button>
  )
  const button = screen.getByRole('button', { name: 'Save' })
  expect(button.getAttribute('type')).toBe('submit')
  expect(button.className).toMatch(/tonal/)
})

it('renders its child instead of a button with asChild', () => {
  render(
    <Button asChild variant="text">
      <a href="/help">Help</a>
    </Button>
  )
  expect(screen.getByRole('link', { name: 'Help' }).className).toMatch(/text/)
})

it('labels the text field and reports errors accessibly', () => {
  render(<TextField label="Username" error="Required" />)
  const input = screen.getByLabelText('Username')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByRole('alert').textContent).toBe('Required')
  expect(input.getAttribute('aria-describedby')).toBe(
    screen.getByRole('alert').id
  )
})
