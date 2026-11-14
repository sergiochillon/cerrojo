// Correcto: no verifica JWT porque la llama Stripe, pero valida la firma del webhook.
import Stripe from 'https://esm.sh/stripe@14';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

Deno.serve(async (req) => {
  const firma = req.headers.get('stripe-signature')!;
  const evento = await stripe.webhooks.constructEventAsync(await req.text(), firma, Deno.env.get('STRIPE_WEBHOOK_SECRET')!);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (evento.type === 'checkout.session.completed') {
    await admin.from('profiles').update({ plan: 'pro' }).eq('id', evento.data.object.client_reference_id);
  }
  return new Response('ok');
});
