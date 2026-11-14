// FALLO: las notas (texto libre escrito por usuarios) se insertan como HTML sin sanear.
export function ClientNotes({ notes }: { notes: string }) {
  return <div className="prose" dangerouslySetInnerHTML={{ __html: notes }} />;
}
