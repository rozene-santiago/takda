import { useState } from "react";
import { Save } from "lucide-react";
import { Modal, Field, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useCreateSavePoint } from "@/lib/hooks";
import { notify } from "@/lib/save-file";

export function SavePointModal({ onClose }: { onClose: () => void }) {
  const create = useCreateSavePoint();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  return (
    <Modal open onClose={onClose} title="Create save point"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => create.mutate({ name: name.trim() || undefined, note: note.trim() || null }, { onSuccess: () => { notify("Save point created."); onClose(); } })}
          disabled={create.isPending} className="bg-brand text-white hover:bg-brand-mid">
          <Save className="size-4" /> {create.isPending ? "Saving…" : "Save snapshot"}
        </Button>
      </>}>
      <p className="text-sm text-muted-foreground mb-3">Keeps a copy of everything — setup, teaching loads and the full schedule — so you can go back to it later from Setup → Save Points.</p>
      <Field label="Name (optional)">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`Save ${new Date().toLocaleDateString()}`} />
      </Field>
      <Field label="Note (optional)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Before rebalancing Grade 8 load" />
      </Field>
    </Modal>
  );
}
