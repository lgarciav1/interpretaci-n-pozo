import { registry } from '../../modules';
import { runTournamentTask, type TournamentRequest } from '../../core/tournament/run';
self.addEventListener('message', (event: MessageEvent<TournamentRequest>) => {
  void runTournamentTask(event.data, registry).then(result => self.postMessage({ result })).catch((error: unknown) => self.postMessage({ error: error instanceof Error ? error.message : String(error) }));
});
