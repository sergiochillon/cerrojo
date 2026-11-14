// App ficticia de demostración. Las variables VITE_* acaban en el navegador.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// FALLO: una clave de un servicio de IA expuesta como variable pública.
export const aiKey = import.meta.env.VITE_OPENAI_API_KEY;
