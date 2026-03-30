import { describe, test, expect } from 'bun:test';
import { getDaemonSpawnArgs } from '../src/daemon';

// NOTE(victor): compiled binaries have virtual bunfs paths (/$bunfs/...),
// dev mode has real filesystem paths - spawn args differ accordingly
describe('getDaemonSpawnArgs', () => {
  test('should_return_direct_binary_args_when_compiled', () => {
    const argv1 = '/$bunfs/root/mcpx';
    const execPath = '/opt/homebrew/bin/mcpx';

    const result = getDaemonSpawnArgs(argv1, execPath);

    expect(result).toEqual(['/opt/homebrew/bin/mcpx', 'daemon', 'start']);
  });

  test('should_return_bun_run_args_when_dev_mode', () => {
    const argv1 = '/home/runner/work/mcpx/src/index.ts';
    const execPath = '/usr/bin/bun';

    const result = getDaemonSpawnArgs(argv1, execPath);

    expect(result).toEqual([
      'bun',
      'run',
      '/home/runner/work/mcpx/src/index.ts',
      'daemon',
      'start',
    ]);
  });

  test('should_handle_bunfs_paths_with_nested_directories', () => {
    const argv1 = '/$bunfs/root/deep/nested/path/mcpx';
    const execPath = '/usr/local/bin/mcpx';

    const result = getDaemonSpawnArgs(argv1, execPath);

    expect(result).toEqual(['/usr/local/bin/mcpx', 'daemon', 'start']);
  });
});

// NOTE(victor): daemon subprocess must bypass normal CLI config parsing.
// index.ts checks _MCPX_DAEMON before loadConfig so the daemon process starts
// cleanly and receives resolved server configs via IPC instead.
