---
name: primer-react
description: Primer React development patterns and component reference. Use when building React UI components, working with Primer components, or styling with design tokens.
---

# Primer React Patterns

Modern Primer React uses CSS-first patterns with design tokens. These guidelines ensure compatibility with the latest @primer/react patterns.

## When to Use This Skill

- Building React UI components
- Working with Primer React components
- Styling with CSS custom properties (design tokens)
- Migrating from deprecated patterns

## Critical: No `sx` Prop

**Most Primer components no longer support the `sx` prop.** Use `className` with CSS utilities or inline styles with CSS custom properties.

```tsx
// ❌ WRONG - sx prop is deprecated on most components
<Button sx={{ marginTop: 2 }}>Click</Button>
<Text sx={{ color: 'fg.muted' }}>Text</Text>
<Stack gap={2}>Items</Stack>

// ✅ CORRECT - Use className or wrapper div with styles
<Button className="mt-2">Click</Button>
<span className="fgColor-muted">Text</span>
<Stack gap="normal">Items</Stack>
```

## Stack Component API

Stack uses **string literals** for layout values, NOT numbers:

```tsx
// Gap values (not numbers!)
gap: 'none' | 'condensed' | 'normal' | 'spacious'

// Align values (not flex-* values!)
align: 'stretch' | 'start' | 'center' | 'end' | 'baseline'

// Justify values
justify: 'start' | 'center' | 'end' | 'space-between' | 'space-evenly'

// Direction values  
direction: 'horizontal' | 'vertical'

// Example usage
<Stack direction="horizontal" gap="normal" align="center" justify="space-between">
  <Stack.Item grow>Content</Stack.Item>
  <Stack.Item>Sidebar</Stack.Item>
</Stack>
```

## Common Pitfalls

1. **Stack gap numbers**: Use `'normal'` not `{2}`
2. **Stack align values**: Use `'start'` not `'flex-start'`
3. **Tooltip missing text**: Always include `text` prop
4. **sx prop errors**: Most components don't support `sx` anymore
5. **Box import**: Box may not be exported from @primer/react
6. **Flash component**: Deprecated, use Banner instead

## Component Migration Quick Reference

| Old Pattern | New Pattern |
|-------------|-------------|
| `sx={{ color: 'fg.muted' }}` | `className="fgColor-muted"` |
| `sx={{ bg: 'canvas.subtle' }}` | `style={{ backgroundColor: 'var(--bgColor-muted)' }}` |
| `<Flash>` | `<Banner>` |
| `<Box>` | `<div>` with className |
| `gap={2}` on Stack | `gap="normal"` |
| `align="flex-start"` | `align="start"` |
| `Tooltip aria-label` | `Tooltip text` |

## Tooltip Component

```tsx
// ❌ WRONG
<Tooltip aria-label="Help text">
  <IconButton icon={InfoIcon} />
</Tooltip>

// ✅ CORRECT  
<Tooltip text="Help text">
  <IconButton icon={InfoIcon} aria-label="Info" />
</Tooltip>
```

## Banner Component (replaces Flash)

```tsx
<Banner
  title="Warning"
  description="Your session is about to expire."
  variant="warning"  // 'info' | 'warning' | 'critical' | 'success'
  onDismiss={() => setShow(false)}
  primaryAction={<Banner.PrimaryAction>Renew</Banner.PrimaryAction>}
  secondaryAction={<Banner.SecondaryAction>Dismiss</Banner.SecondaryAction>}
/>
```

## Button Component

```tsx
// Variants
<Button variant="primary">Primary</Button>
<Button variant="default">Default</Button>
<Button variant="invisible">Invisible</Button>
<Button variant="danger">Danger</Button>

// Sizes
<Button size="small">Small</Button>
<Button size="medium">Medium (default)</Button>
<Button size="large">Large</Button>

// With icons
<Button leadingVisual={RocketIcon}>Launch</Button>
<Button trailingVisual={DownloadIcon}>Download</Button>

// States
<Button loading>Saving...</Button>
<Button inactive>Unavailable</Button>
<Button block>Full Width</Button>
```

## CSS Custom Properties (Design Tokens)

### Colors

```css
/* Foreground (text) */
--fgColor-default, --fgColor-muted, --fgColor-accent
--fgColor-success, --fgColor-attention, --fgColor-danger

/* Background */
--bgColor-default, --bgColor-muted, --bgColor-inset
--bgColor-emphasis, --bgColor-accent-muted

/* Border */
--borderColor-default, --borderColor-muted
--borderColor-accent-muted, --borderColor-accent-emphasis

/* Shadow */
--shadow-small, --shadow-medium, --shadow-large
```

### Sizing/Spacing

```css
--base-size-4, --base-size-8, --base-size-12, --base-size-16
--base-size-20, --base-size-24, --base-size-32, --base-size-40
```

### Border Radius

```css
--borderRadius-small, --borderRadius-medium, --borderRadius-large
```

## Form Components

Always wrap inputs in FormControl for accessibility:

```tsx
<FormControl required>
  <FormControl.Label>Email</FormControl.Label>
  <FormControl.Caption>Your work email address</FormControl.Caption>
  <TextInput type="email" block />
  <FormControl.Validation variant="error">Invalid email</FormControl.Validation>
</FormControl>
```

## Layout Components

### PageLayout

```tsx
<PageLayout>
  <PageLayout.Header divider="line">Header</PageLayout.Header>
  <PageLayout.Content>Main content</PageLayout.Content>
  <PageLayout.Pane position="end" width="medium" sticky resizable divider="line">
    Sidebar
  </PageLayout.Pane>
  <PageLayout.Footer divider="line">Footer</PageLayout.Footer>
</PageLayout>
```

## Navigation Components

### NavList

```tsx
<NavList>
  <NavList.Item href="/" aria-current={isHome ? 'page' : undefined}>
    <NavList.LeadingVisual><HomeIcon /></NavList.LeadingVisual>
    Home
  </NavList.Item>
  <NavList.Group title="Section">
    <NavList.Item href="/settings">Settings</NavList.Item>
  </NavList.Group>
</NavList>
```

## Dialog Components

```tsx
const buttonRef = useRef<HTMLButtonElement>(null)
const [isOpen, setIsOpen] = useState(false)

<Button ref={buttonRef} onClick={() => setIsOpen(true)}>Open</Button>
{isOpen && (
  <Dialog
    title="Dialog Title"
    onClose={() => setIsOpen(false)}
    returnFocusRef={buttonRef}
    footerButtons={[
      {buttonType: 'default', content: 'Cancel', onClick: () => setIsOpen(false)},
      {buttonType: 'primary', content: 'Save', onClick: handleSave},
    ]}
  >
    Dialog content
  </Dialog>
)}
```

## ActionMenu

```tsx
<ActionMenu>
  <ActionMenu.Button>Open menu</ActionMenu.Button>
  <ActionMenu.Overlay>
    <ActionList selectionVariant="single">
      <ActionList.Item selected={selected} onSelect={handleSelect}>
        <ActionList.LeadingVisual><GearIcon /></ActionList.LeadingVisual>
        Settings
        <ActionList.Description>Configure options</ActionList.Description>
      </ActionList.Item>
      <ActionList.Divider />
      <ActionList.Item variant="danger">Delete</ActionList.Item>
    </ActionList>
  </ActionMenu.Overlay>
</ActionMenu>
```

## Required Setup

```tsx
// Theme CSS (pick themes you need)
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'

// Components
import { ThemeProvider, BaseStyles } from '@primer/react'

// Root layout wrapper
function App() {
  return (
    <ThemeProvider colorMode="auto">
      <BaseStyles>
        <YourApp />
      </BaseStyles>
    </ThemeProvider>
  )
}
```

## Icons

```tsx
import { 
  GearIcon, 
  RocketIcon, 
  CopilotIcon,
  CheckCircleIcon,
} from '@primer/octicons-react'

// Use with size prop
<GearIcon size={16} />
<GearIcon size="small" />  // 16px
<GearIcon size="medium" /> // 24px
```

## Accessibility Checklist

1. **All IconButtons must have `aria-label`**
2. **Form inputs need associated labels** - Use FormControl.Label
3. **ActionLists need `aria-label` or `aria-labelledby`**
4. **Dialogs need `returnFocusRef`** - Return focus to trigger on close
5. **Selection components need proper ARIA roles**
6. **Loading states should be announced** - Use `aria-live` regions
7. **Error messages should be associated** - FormControl.Validation handles this

## References

- [Primer React Documentation](https://primer.style/react)
- [Primer Design Tokens](https://primer.style/foundations/primitives)
- [Primer Octicons](https://primer.style/foundations/icons)
