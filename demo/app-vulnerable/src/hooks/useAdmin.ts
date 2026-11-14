// FALLO: el "permiso" de administrador se decide en el navegador.
export function useAdmin(): boolean {
  return localStorage.getItem('isAdmin') === 'true';
}
