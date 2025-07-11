#!/usr/bin/env bun

/**
 * Prepare the Claude action by checking trigger conditions, verifying human actor,
 * and creating the initial tracking comment
 */

import * as core from "@actions/core";
import { setupGitHubToken } from "../github/token";
import { checkTriggerAction } from "../github/validation/trigger";
import { checkHumanActor } from "../github/validation/actor";
import { checkWritePermissions } from "../github/validation/permissions";
import { createInitialComment } from "../github/operations/comments/create-initial";
import { setupBranch } from "../github/operations/branch";
import { updateTrackingComment } from "../github/operations/comments/update-with-branch";
import { prepareMcpConfig } from "../mcp/install-mcp-server";
import { createPrompt } from "../create-prompt";
import { createOctokit } from "../github/api/client";
import { fetchGitHubData } from "../github/data/fetcher";
import { parseGitHubContext } from "../github/context";

async function run() {
  try {
    // Step 1: Setup GitHub token
    const githubToken = await setupGitHubToken();
    const octokit = createOctokit(githubToken);

    // Step 2: Parse GitHub context (once for all operations)
    const context = parseGitHubContext();

    // Step 3: Check trigger conditions first
    const containsTrigger = await checkTriggerAction(context);

    if (!containsTrigger) {
      console.log("No trigger found, skipping remaining steps");
      return;
    }

    // Step 4: Check if this is a self-review comment
    let isSelfReview = false;
    if (context.eventName === "issue_comment" && context.payload.comment) {
      const commentBody = context.payload.comment.body || "";
      const commentUser = context.payload.comment.user;
      // Check for self-review marker and ensure it's from GitHub Actions bot
      if (commentBody.includes("<!-- claude-self-review -->") && 
          commentUser.type === "Bot" && 
          commentUser.login === "github-actions[bot]") {
        console.log("This is a self-review comment from GitHub Actions bot, skipping actor and permission checks");
        isSelfReview = true;
      }
    }

    // Step 5: Check write permissions (skip for self-review)
    if (!isSelfReview) {
      const hasWritePermissions = await checkWritePermissions(
        octokit.rest,
        context,
      );
      if (!hasWritePermissions) {
        throw new Error(
          "Actor does not have write permissions to the repository",
        );
      }
    }

    // Step 6: Check if actor is human (skip for self-review)
    if (!isSelfReview) {
      await checkHumanActor(octokit.rest, context);
    }

    // Step 7: Create initial tracking comment
    const commentId = await createInitialComment(octokit.rest, context);

    // Step 8: Fetch GitHub data (once for both branch setup and prompt creation)
    const githubData = await fetchGitHubData({
      octokits: octokit,
      repository: `${context.repository.owner}/${context.repository.repo}`,
      prNumber: context.entityNumber.toString(),
      isPR: context.isPR,
      triggerUsername: context.actor,
    });

    // Step 9: Setup branch
    const branchInfo = await setupBranch(octokit, githubData, context);

    // Step 10: Update initial comment with branch link (only for issues that created a new branch)
    if (branchInfo.claudeBranch) {
      await updateTrackingComment(
        octokit,
        context,
        commentId,
        branchInfo.claudeBranch,
      );
    }

    // Step 11: Create prompt file
    await createPrompt(
      commentId,
      branchInfo.baseBranch,
      branchInfo.claudeBranch,
      githubData,
      context,
    );

    // Step 12: Get MCP configuration
    const additionalMcpConfig = process.env.MCP_CONFIG || "";
    const mcpConfig = await prepareMcpConfig({
      githubToken,
      owner: context.repository.owner,
      repo: context.repository.repo,
      branch: branchInfo.currentBranch,
      additionalMcpConfig,
      claudeCommentId: commentId.toString(),
      allowedTools: context.inputs.allowedTools,
      context,
    });
    core.setOutput("mcp_config", mcpConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(`Prepare step failed with error: ${errorMessage}`);
    // Also output the clean error message for the action to capture
    core.setOutput("prepare_error", errorMessage);
    process.exit(1);
  }
}

if (import.meta.main) {
  run();
}
