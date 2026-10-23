"""Run the site's 4th down engine from Python: every request in one Node
process (engine_batch.ts), so a pipeline run loads the model once and gets
exactly the numbers the calculator shows. Needs Node 23.6 or newer on the
path (the workflows install 24), which runs the TypeScript directly.

The engine is nfl4th, reproduced (docs/methods/fourth-down-model.md). A
result is the contract's FourthDownResult or TryResult
(docs/model-interface.md): never an exception, 'unavailable' when the model
cannot run.
"""

import json
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / 'engine_batch.ts'


class EngineError(RuntimeError):
    """Node failed to start or exited before answering every request."""


def run_engine(requests: list[dict]) -> tuple[str, list[dict]]:
    """(model version, one result per request, in order). Each request is
    {"kind": "fourth-down" | "try", "situation": {...}}."""
    payload = ''.join(
        json.dumps({'id': i, 'kind': r['kind'], 'situation': r['situation']}) + '\n' for i, r in enumerate(requests)
    )
    try:
        done = subprocess.run(['node', str(SCRIPT)], input=payload, capture_output=True, text=True, check=False)
    except FileNotFoundError as error:
        raise EngineError('node is not installed') from error
    if done.returncode != 0:
        raise EngineError(done.stderr.strip()[-2000:])
    lines = done.stdout.splitlines()
    header = json.loads(lines[0])
    results = [json.loads(line) for line in lines[1:]]
    if [r['id'] for r in results] != list(range(len(requests))):
        raise EngineError(f'{len(results)} results for {len(requests)} requests')
    if not header['loaded']:
        raise EngineError(f"model {header['modelVersion']} did not load")
    return header['modelVersion'], [r['result'] for r in results]
