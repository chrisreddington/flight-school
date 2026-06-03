import { hashUserId } from '../audit';

const userId = process.argv[2];

if (!userId) {
  process.stderr.write('Expected user id argument at argv[2].\n');
  process.exit(1);
}

process.stdout.write(hashUserId(userId));
