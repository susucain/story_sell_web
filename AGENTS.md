# Frontend Contribution Guide

Apply these rules to all work under `agui-frontend/`.

## Project Context

- Use React 19, TypeScript, Vite, React Router, Ant Design, and Tailwind CSS.
- Keep application source in `src/`; retain the existing `@/` import alias for `src/`.
- Follow established local component, styling, and API-client patterns before introducing a new one.
- Do not edit generated `dist/` files. Build output is produced by `pnpm build`.
- Do not add dependencies unless the task needs a capability the existing stack cannot provide.

## Component Design

- Keep each React component implementation file at 300 or fewer non-blank, non-comment lines.
- Before a change would exceed this limit, extract a cohesive UI concern into a sibling component, reusable state or side-effect logic into a `useX` hook, or pure transformations into a utility module.
- Split by responsibility, not line count. Each extracted module must have a clear owner and public API.
- Treat type-only files, tests, stories, and generated files independently from this limit.
- Do not enlarge an existing oversized component. Extract the concern being changed when practical; leave unrelated cleanup out of scope.
- Keep state close to the component that owns it. Lift state only when multiple consumers need the same source of truth.
- Derive values during render when possible. Do not introduce `useEffect` for derived state, event handling, or synchronous calculations.
- Avoid `useMemo`, `useCallback`, and `memo` unless an expensive computation, referential-stability contract, or measured rendering issue justifies them.
- Render explicit loading, empty, and error states for asynchronous user-facing data.
- Preserve keyboard access, focus behavior, accessible names, and semantic HTML when changing interactive UI.

## TypeScript

- Define component props with `type`, and do not use `React.FC`.
- Do not use `any`. Avoid broad type assertions and non-null assertions; narrow values or validate untrusted data at the boundary.
- Model mutually exclusive props or UI states with discriminated unions instead of conflicting boolean props.
- For components that wrap a DOM element, compose native props with `ComponentPropsWithoutRef<"element">` when the native API should be exposed.
- Prefer inferred types for local implementation details. Explicitly type exported functions, public component props, API payloads, and complex state.
- Keep API data types close to the API client. Convert transport data to presentation-specific shapes outside rendering components.

## React Performance

- Keep client-side request work parallel when requests are independent. Do not create avoidable request waterfalls.
- Avoid duplicate state and repeated expensive work on every render.
- Import modules narrowly where the package supports it, and use lazy loading only for meaningful route or feature boundaries.
- Keep component boundaries intentional: do not move broad application state into a shared provider without a demonstrated need.

## Verification

- Run `pnpm lint` after TypeScript or React changes.
- Run `pnpm build` after changes that affect production behavior, routing, dependencies, or Vite configuration.
- Report validation commands that could not be run and the reason.
