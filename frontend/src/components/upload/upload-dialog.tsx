import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError } from '@/services/api';
import { useUploadTranscript } from '@/hooks/use-api';

const EXAMPLE = `[00:00-00:05] Agent: Vanakkam sir, Suresh here from Skyline Properties
[00:05-00:12] Lead: haan sollunga, enna vishayam?
[00:12-00:25] Agent: Sir, Velachery-la oru puthusa 3BHK launch pannirukom, 85 lakhs starting
[00:25-00:34] Lead: budget konjam over. 70 lakhs varaikkum thaan paakuren
[00:34-00:45] Agent: Sir, 2BHK 68 lakhs iruku. Saturday site visit varugireengala?
[00:45-00:52] Lead: ok Saturday morning vandhu paakuren`;

/**
 * Transcript analysis dialog.
 *
 * Three things the original upload lacked: a disabled/pending state on the
 * button (so it cannot be double-submitted), a visible outcome on both success
 * and failure, and the required input format shown inline rather than behind a
 * separate popup.
 */
export function UploadDialog({
  open,
  onClose,
  uploadsEnabled,
}: {
  open: boolean;
  onClose: () => void;
  uploadsEnabled: boolean;
}) {
  const [transcript, setTranscript] = useState('');
  const [telecallerName, setTelecallerName] = useState('');
  const [leadName, setLeadName] = useState('');
  const upload = useUploadTranscript();
  const { notify } = useToast();
  const navigate = useNavigate();

  function reset() {
    setTranscript('');
    setTelecallerName('');
    setLeadName('');
    upload.reset();
  }

  async function submit() {
    try {
      const result = await upload.mutateAsync({
        transcript,
        persist: true,
        ...(telecallerName.trim() ? { telecallerName: telecallerName.trim() } : {}),
        ...(leadName.trim() ? { leadName: leadName.trim() } : {}),
      });

      notify({
        tone: 'success',
        title: result.duplicate
          ? 'This transcript was already analyzed'
          : `Analyzed — score ${result.call.overallScore.toFixed(2)}/5`,
        description: result.duplicate
          ? 'Opening the existing call. No model call was needed.'
          : result.cached
            ? 'Served from cache, so this cost nothing.'
            : result.call.analysis.warnings[0],
      });

      reset();
      onClose();
      void navigate(`/calls/${result.call.callId}`);
    } catch (error) {
      notify({
        tone: 'error',
        title:
          error instanceof ApiRequestError && error.status === 429
            ? 'Upload limit reached'
            : 'Analysis failed',
        description:
          error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!upload.isPending) onClose();
      }}
      title="Analyze a transcript"
      description="Runs the pipeline on a new call and adds it to the dashboard."
    >
      {!uploadsEnabled && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-accent p-3">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-secondary-foreground">
            The server has no LLM API key configured, so analysis is disabled. Browsing existing
            calls is unaffected. Set <code className="font-mono">GROQ_API_KEY</code> to enable this.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="telecaller">Telecaller (optional)</Label>
          <Input
            id="telecaller"
            value={telecallerName}
            onChange={(event) => setTelecallerName(event.target.value)}
            placeholder="Suresh Kumar"
            disabled={upload.isPending}
          />
        </div>
        <div>
          <Label htmlFor="lead">Lead (optional)</Label>
          <Input
            id="lead"
            value={leadName}
            onChange={(event) => setLeadName(event.target.value)}
            placeholder="Meenakshi Sundaram"
            disabled={upload.isPending}
          />
        </div>
      </div>

      <div className="mt-3">
        <Label htmlFor="transcript">Transcript</Label>
        <Textarea
          id="transcript"
          rows={10}
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
          placeholder={EXAMPLE}
          disabled={upload.isPending}
          aria-describedby="transcript-format"
        />
        <p id="transcript-format" className="mt-1.5 text-xs text-muted-foreground">
          One line per turn, in the form{' '}
          <code className="font-mono">[mm:ss-mm:ss] Speaker: text</code>. Tamil-English mixed speech
          is expected.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTranscript(EXAMPLE)}
          disabled={upload.isPending}
        >
          Use example
        </Button>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={upload.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            // Disabled while in flight: the request costs a model call, so a
            // double-click must not be able to spend twice.
            disabled={upload.isPending || transcript.trim().length < 20 || !uploadsEnabled}
          >
            {upload.isPending ? (
              <>
                <Loader2 className="animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Sparkles />
                Analyze
              </>
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
