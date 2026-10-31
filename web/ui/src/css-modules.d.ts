declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

// Generated token files, imported for their custom properties.
declare module '*.gen.css'
