"use client";

import Add from "@carbon/icons-react/es/Add";
import { CURRENCIES } from "@crm/db/currency";
import { DealStage } from "@crm/db/enums";
import { Button } from "@crm/ui/components/button";
import { DatePicker } from "@crm/ui/components/date-picker";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@crm/ui/components/sheet";
import { Spinner } from "@crm/ui/components/spinner";
import { Textarea } from "@crm/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseAsBoolean, useQueryState } from "nuqs";
import { type ComponentProps, Suspense, useId, useState } from "react";
import { toast } from "sonner";
import { CompanyPicker } from "@/components/crm/company-picker";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { dealStageLabel, OPEN_STAGES } from "@/lib/deal-stage";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

const UNSET = "";

function AddButton(props: ComponentProps<typeof Button>) {
	return (
		<Button {...props}>
			<Icon icon={Add} data-icon="inline-start" />
			New project
		</Button>
	);
}

export function CreateDealSheet({ companyId }: { companyId?: string }) {
	return (
		<Suspense fallback={<AddButton disabled />}>
			<CreateDealForm companyId={companyId} />
		</Suspense>
	);
}

function CreateDealForm({ companyId }: { companyId?: string }) {
	const openRecord = useOpenRecord();
	const trpc = useTRPC();
	const cache = useCrmCache();

	const [open, setOpen] = useQueryState(
		SEARCH_PARAM.dialog.create,
		parseAsBoolean.withDefault(false),
	);
	const [name, setName] = useState("");
	const [company, setCompany] = useState(companyId ?? UNSET);
	const [ownerId, setOwnerId] = useState(UNSET);
	const [stage, setStage] = useState<DealStage>(DealStage.LEAD);
	const [projectType, setProjectType] = useState("");
	const [leadSource, setLeadSource] = useState("");
	const [description, setDescription] = useState("");
	const [addressLine1, setAddressLine1] = useState("");
	const [addressLine2, setAddressLine2] = useState("");
	const [city, setCity] = useState("");
	const [state, setState] = useState("");
	const [postalCode, setPostalCode] = useState("");
	const [amount, setAmount] = useState("");
	const [currency, setCurrency] = useState("");
	const [targetDate, setTargetDate] = useState("");

	const nameId = useId();
	const projectTypeId = useId();
	const leadSourceId = useId();
	const descriptionId = useId();
	const addressLine1Id = useId();
	const addressLine2Id = useId();
	const cityId = useId();
	const stateId = useId();
	const postalCodeId = useId();
	const amountId = useId();
	const targetDateId = useId();

	const users = useQuery(trpc.users.list.queryOptions());
	const me = useQuery(trpc.users.me.queryOptions());
	const currencies = useQuery(trpc.currency.settings.queryOptions());

	const resolvedOwner = ownerId || me.data?.id || UNSET;
	const workspaceCurrency = currencies.data?.reportingCurrency;
	const resolvedCurrency = currency || workspaceCurrency || "USD";

	const create = useMutation(
		trpc.deals.create.mutationOptions({
			onSuccess: async (project) => {
				await cache.deal(project.id);
				toast.success(`${project.name} added.`);
				await setOpen(null);
				setName("");
				setCompany(companyId ?? UNSET);
				setOwnerId("");
				setStage(DealStage.LEAD);
				setProjectType("");
				setLeadSource("");
				setDescription("");
				setAddressLine1("");
				setAddressLine2("");
				setCity("");
				setState("");
				setPostalCode("");
				setAmount("");
				setCurrency("");
				setTargetDate("");
				openRecord({ kind: "deal", id: project.id });
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const ready = name.trim() !== "" && resolvedOwner !== UNSET;

	return (
		<Sheet open={open} onOpenChange={(next) => setOpen(next || null)}>
			<SheetTrigger asChild>
				<AddButton />
			</SheetTrigger>
			<SheetContent side="right">
				<SheetHeader>
					<SheetTitle>New project</SheetTitle>
					<SheetDescription>
						Track the customer, job site, status, and next steps. Company is
						optional.
					</SheetDescription>
				</SheetHeader>

				<form
					id="create-project"
					className="flex-1 overflow-y-auto px-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (!ready) return;
						const parsed = Number.parseFloat(amount);
						create.mutate({
							name,
							companyId: company || null,
							ownerId: resolvedOwner,
							stage,
							projectType: projectType || null,
							leadSource: leadSource || null,
							description: description || null,
							addressLine1: addressLine1 || null,
							addressLine2: addressLine2 || null,
							city: city || null,
							state: state || null,
							postalCode: postalCode || null,
							amountCents: Number.isFinite(parsed)
								? Math.round(parsed * 100)
								: null,
							currency: currency || workspaceCurrency,
							expectedCloseDate: targetDate || null,
						});
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor={nameId}>Project name</FieldLabel>
							<Input
								id={nameId}
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="Kitchen remodel"
								autoComplete="off"
								required
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor="create-project-company">Company</FieldLabel>
							<CompanyPicker
								id="create-project-company"
								value={company}
								onValueChange={setCompany}
								none={{ value: UNSET, label: "No company" }}
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor="create-project-owner">Owner</FieldLabel>
							<Select value={resolvedOwner} onValueChange={setOwnerId}>
								<SelectTrigger id="create-project-owner">
									<SelectValue placeholder="Choose an owner" />
								</SelectTrigger>
								<SelectContent>
									{(users.data ?? []).map((user) => (
										<SelectItem key={user.id} value={user.id}>
											{user.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>

						<Field>
							<FieldLabel htmlFor="create-project-status">Status</FieldLabel>
							<Select
								value={stage}
								onValueChange={(value) => setStage(value as DealStage)}
							>
								<SelectTrigger id="create-project-status">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{OPEN_STAGES.map((option) => (
										<SelectItem key={option} value={option}>
											{dealStageLabel(option)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<FieldDescription>New projects start as Lead.</FieldDescription>
						</Field>

						<Field>
							<FieldLabel htmlFor={projectTypeId}>Project type</FieldLabel>
							<Input
								id={projectTypeId}
								value={projectType}
								onChange={(event) => setProjectType(event.target.value)}
								placeholder="Kitchen remodel"
								autoComplete="off"
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor={leadSourceId}>Lead source</FieldLabel>
							<Input
								id={leadSourceId}
								value={leadSource}
								onChange={(event) => setLeadSource(event.target.value)}
								placeholder="Referral"
								autoComplete="off"
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor={descriptionId}>Description</FieldLabel>
							<Textarea
								id={descriptionId}
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								placeholder="Scope, customer goals, and next steps"
								rows={4}
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor={addressLine1Id}>Job-site address</FieldLabel>
							<Input
								id={addressLine1Id}
								value={addressLine1}
								onChange={(event) => setAddressLine1(event.target.value)}
								placeholder="123 Main Street"
								autoComplete="street-address"
							/>
							<Input
								id={addressLine2Id}
								value={addressLine2}
								onChange={(event) => setAddressLine2(event.target.value)}
								placeholder="Suite or unit"
								aria-label="Address line 2"
								autoComplete="address-line2"
							/>
							<div className="grid gap-2 sm:grid-cols-3">
								<Input
									id={cityId}
									value={city}
									onChange={(event) => setCity(event.target.value)}
									placeholder="City"
									aria-label="City"
									autoComplete="address-level2"
								/>
								<Input
									id={stateId}
									value={state}
									onChange={(event) => setState(event.target.value)}
									placeholder="State"
									aria-label="State"
									autoComplete="address-level1"
								/>
								<Input
									id={postalCodeId}
									value={postalCode}
									onChange={(event) => setPostalCode(event.target.value)}
									placeholder="ZIP code"
									aria-label="ZIP code"
									autoComplete="postal-code"
								/>
							</div>
						</Field>

						<Field>
							<FieldLabel htmlFor={amountId}>Amount</FieldLabel>
							<div className="flex gap-2">
								<Input
									id={amountId}
									value={amount}
									onChange={(event) => setAmount(event.target.value)}
									placeholder="24000"
									inputMode="decimal"
									autoComplete="off"
								/>
								<Select value={resolvedCurrency} onValueChange={setCurrency}>
									<SelectTrigger
										aria-label="Currency"
										className="w-28 shrink-0"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{CURRENCIES.map((entry) => (
											<SelectItem key={entry.code} value={entry.code}>
												{entry.code}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</Field>

						<Field>
							<FieldLabel htmlFor={targetDateId}>Target date</FieldLabel>
							<DatePicker
								id={targetDateId}
								value={targetDate}
								onChange={setTargetDate}
								placeholder="No target date yet"
							/>
						</Field>
					</FieldGroup>
				</form>

				<SheetFooter>
					<Button
						type="submit"
						form="create-project"
						disabled={create.isPending || !ready}
					>
						{create.isPending ? <Spinner /> : null}
						Create project
					</Button>
					<SheetClose asChild>
						<Button variant="outline">Cancel</Button>
					</SheetClose>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
