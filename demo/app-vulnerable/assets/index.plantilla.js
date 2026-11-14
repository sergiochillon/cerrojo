/* Plantilla del "bundle" de la app ficticia. El servidor de demostración sustituye los
   marcadores __…__ por valores generados al arrancar, para que en el repositorio no haya
   ninguna cadena con formato de secreto. Imita la forma de un build de Vite minificado. */
import{createClient as Cc}from"./vendor-1b2c3d.js";const createClient=Cc;
const sb=createClient("__SUPABASE_URL__","__ANON_KEY__",{auth:{persistSession:!0}});
const ia={apiKey:"__CLAVE_IA__",model:"gpt-x"};
async function perfiles(){return sb.from("profiles").select("*")}
async function clientes(){return sb.from("clients").select("*").order("created_at")}
async function facturas(u){return sb.from("invoices").select("*").eq("user_id",u)}
async function directorio(){return sb.from("client_directory").select("*")}
async function tokens(){return sb.from("integration_tokens").select("provider,access_token")}
async function planes(){return sb.from("plans").select("*")}
async function espera(e){return sb.from("waitlist").insert({email:e})}
async function registro(){return sb.from("audit_log").select("*")}
async function antiguo(){return sb.from("legacy_orders").select("*")}
async function pdfs(u){return sb.storage.from("invoices-pdf").list(u)}
async function avatar(p){return sb.storage.from("avatars").getPublicUrl(p)}
async function esAdmin(u){return sb.rpc("is_admin",{uid:u})}
async function borrarCuenta(){return sb.functions.invoke("delete-account",{body:{}})}
const letras=Array.from("abc"),bytes=Uint8Array.from("x");
export{perfiles,clientes,facturas,directorio,tokens,planes,espera,registro,antiguo,pdfs,avatar,esAdmin,borrarCuenta,ia,letras,bytes};
//# sourceMappingURL=index-4f3a9c.js.map
