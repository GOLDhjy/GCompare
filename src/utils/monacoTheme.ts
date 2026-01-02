export function getMonacoTheme(appTheme: 'light' | 'dark'): string {
  return appTheme === 'dark' ? 'vs-dark' : 'vs';
}
