import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Button, Dialog, TextField } from '.'

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
  const link = screen.getByRole('link', { name: 'Help' })
  expect(link.className).toMatch(/text/)
  // The state layer still lands inside the link.
  expect(link.querySelector('[aria-hidden]')).not.toBeNull()
})

it('picks up the tokens for its size and variant', () => {
  render(
    <Button variant="outlined" size="l" shape="square">
      Play
    </Button>
  )
  const classes = screen.getByRole('button').classList
  expect(classes).toContain('md-comp-button-large')
  expect(classes).toContain('md-comp-outlined-button')
})

it('is a toggle when given selected, with tonal toggles on their own tokens', () => {
  const { rerender } = render(
    <Button variant="tonal" selected={false}>
      Shuffle
    </Button>
  )
  const button = screen.getByRole('button', { name: 'Shuffle' })
  expect(button.getAttribute('aria-pressed')).toBe('false')
  expect(button.classList).toContain('md-comp-tonal-button')
  rerender(
    <Button variant="tonal" selected>
      Shuffle
    </Button>
  )
  expect(button.getAttribute('aria-pressed')).toBe('true')
})

it('leaves aria-pressed off plain buttons', () => {
  render(<Button>Save</Button>)
  expect(screen.getByRole('button').hasAttribute('aria-pressed')).toBe(false)
})

it('draws a named icon, filled when selected, without naming the button after it', () => {
  render(
    <Button icon="favorite" selected>
      Favourite
    </Button>
  )
  const button = screen.getByRole('button', { name: 'Favourite' })
  const icon = button.querySelector('[translate="no"]')!
  expect(icon.textContent).toBe('favorite')
  expect(icon.getAttribute('aria-hidden')).toBe('true')
  expect(icon.className).toMatch(/filled/)
})

it('ripples from a press and fades when released', () => {
  render(<Button>Press</Button>)
  const button = screen.getByRole('button')
  fireEvent.pointerDown(button, { button: 0, clientX: 4, clientY: 4 })
  const ripples = () => button.querySelectorAll('[aria-hidden] > span')
  expect(ripples()).toHaveLength(1)
  fireEvent.pointerUp(window)
  expect(ripples()[0]!.className).toMatch(/released/)
})

it("doesn't ripple when disabled", () => {
  render(<Button disabled>Press</Button>)
  const button = screen.getByRole('button')
  fireEvent.pointerDown(button, { button: 0 })
  expect(button.querySelectorAll('[aria-hidden] > span')).toHaveLength(0)
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

it('opens a labelled modal dialog and closes it with Escape', () => {
  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Delete Films?"
        description="Files on disk are not touched."
      >
        <Button>Delete</Button>
      </Dialog>
    )
  }
  render(<Harness />)
  const dialog = screen.getByRole('dialog', { name: 'Delete Films?' })
  expect(dialog.getAttribute('aria-describedby')).toBe(
    screen.getByText('Files on disk are not touched.').id
  )
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})
