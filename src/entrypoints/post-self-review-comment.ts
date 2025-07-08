#!/usr/bin/env bun

/**
 * Post a self-review comment after Claude completes work
 */

import * as core from "@actions/core";
import { createOctokit } from "../github/api/client";
import { parseGitHubContext } from "../github/context";

async function run() {
  try {
    // Get required environment variables
    const githubToken = process.env.GITHUB_TOKEN;
    const claudeCommentId = process.env.CLAUDE_COMMENT_ID;
    
    if (!githubToken) {
      throw new Error("GITHUB_TOKEN is required");
    }

    // Parse context
    const context = parseGitHubContext();
    const { owner, repo } = context.repository;

    // Create GitHub client
    const octokit = createOctokit(githubToken);

    // Create self-review comment
    const body = `@claude Please review the changes you just made:

1. **Code Quality**: Are there any potential bugs, security issues, or performance concerns?
2. **Best Practices**: Does the implementation follow established patterns and conventions?
3. **Edge Cases**: Are all edge cases properly handled?
4. **Documentation**: Is the code properly documented?
5. **Testing**: Are there adequate tests for the changes?
6. **Improvements**: What could be done better?

Reference: Original task [comment #${claudeCommentId}](https://github.com/${owner}/${repo}/issues/${context.entityNumber}#issuecomment-${claudeCommentId})`;

    const response = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: context.entityNumber,
      body,
    });

    console.log(`✅ Created self-review comment with ID: ${response.data.id}`);
    core.setOutput("self_review_comment_id", response.data.id.toString());
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(`Post self-review comment failed: ${errorMessage}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  run();
}